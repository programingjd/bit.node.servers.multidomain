const fs = require('fs').promises;
const http = require('http');
const https = require('https');
const http2 = require('http2');
const assert = require('assert');
const Server = require('../server');

const httpPort = 8080;
const httpsPort = 8181;

/**
 * Http methods.
 * @readonly
 * @enum {string}
 */
const Methods={
  head: 'head',
  get: 'get',
  delete: 'delete'
};

const ca=[];

/**
 * @typedef {Object<string,*>} Response
 * @property {number} status
 * @property {Map<String,String>} headers
 * @property {Buffer} body
 */

/**
 * Performs an http request to the local server.
 * @param {string} url
 * @param {Methods=} method
 * @param {boolean=false} disableHttp2
 * @returns {Promise<Response>}
 */
const request=(url,method=Methods.get,disableHttp2=false)=>new Promise((resolve,reject)=>{
  const i = url.indexOf('://');
  const proto = url.substring(0,i);
  const j = url.indexOf('/', i+3);
  const authority = j===-1 ? url.substring(i+3) : url.substring(i+3,j);
  const path = j===-1 ? '/' : url.substring(j);
  const [ request, close ] = (()=>{
    if(proto==='https'&&!disableHttp2){
      const session = http2.connect(`${proto}://${authority}`, {
        ca: ca,
        rejectUnauthorized: true,
        requestCert: true,
        agent: false
      });
      const request = session.request({
        ':method': method.toUpperCase(),
        ':path': path
      });
      return [ request, ()=>session.close() ];
    }
    else{
      const k = authority.indexOf(':');
      const hostname = k===-1 ? authority : authority.substring(0, k);
      if(proto==='http'){
        const port = k===-1 ? 80 : authority.substring(k+1);
        const request = http.request({
          host: hostname,
          port: port,
          path: path,
          method: method.toUpperCase()
        });
        return [ request, ()=>{} ];
      }
      else{
        const port = k===-1 ? 443 : authority.substring(k+1);
        const request = https.request({
          host: hostname,
          port: port,
          path: path,
          method: method.toUpperCase(),
          ca: ca,
          rejectUnauthorized: true,
          requestCert: true,
          agent: false
        });
        return [ request, ()=>{} ];
      }
    }
  })();
  const data = [];
  let status = 0;
  let headers = new Map();
  let error = undefined;
  request.on('error', e=>error=e);
  request.on('response', it=>{
    if(proto==='http'||disableHttp2){
      status = it.statusCode;
      Object.keys(it.headers).forEach(h=>{
        headers.set(h,it.headers[h]);
      });
      it.on('data',it=>data.push(it));
    }
    else{
      status = it[':status'];
      Object.keys(it).forEach(h=>{
        if(h[0]!==':') headers.set(h,it[h]);
      });
      request.on('data',it=>data.push(it));

    }
  });
  request.on('close', ()=>{
    if (error) reject(error);
    resolve(
      {
        status: status,
        headers: headers,
        body: Buffer.concat(data)
      }
    );
    close();
  });
  request.setTimeout(1000).end();
});

let server;

const handler1 = (request,response,hostname,remoteAddress,local,serverInstance)=>{
  response.writeHead(200, { 'Content-Type': 'application/json', 'X-Test': 'test' });
  response.write(JSON.stringify({
    name: 'domain1',
    hostname: hostname,
    method: request.method.toLowerCase(),
    url: request.url,
    remoteAddress: remoteAddress,
    local: local,
    server: serverInstance === server
  }));
  response.end();
};

const handler2 = (request,response,hostname,remoteAddress,local,serverInstance)=>{
  if (hostname.indexOf('www.')===0){
    response.writeHead(301, { 'Location': `https://domain2.com:${httpsPort}${request.path||request.headers[':path']}` });
  }else response.writeHead(200);
  response.end();
};

const domain1 = {
  hostnames: [ 'domain1.com', 'www.domain1.com' ],
  key: {
    path: 'test/domain1.key'
  },
  cert: {
    path: 'test/domain1.cert'
  },
  handler: handler1
};
const domain2 = {
  hostnames: [ 'domain2.com', 'www.domain2.com' ],
  key: {
    path: 'test/domain2.key'
  },
  cert: {
    path: 'test/domain2.cert'
  },
  handler: handler2
};
const domains = [
  domain1, domain2
];

before(async()=>{
  const dns = require('dns');
  const dnsLookup = dns.lookup;
  const hostnames = new Set(domains.flatMap(it=>it.hostnames));
  dns.lookup = function(hostname,options,callback) {
    if (hostnames.has(hostname)){
      if(typeof options==='function'){
        options(null,'127.0.0.1',4);
      }
      else if(typeof callback==='function'){
        const family=(typeof options==='object'?options.family:options)>>>0;
        if(family===0||family===4) callback(null,'127.0.0.1',4);
      }
    }
    return dnsLookup.call(this,hostname,options,callback);
  };
  server = Server(httpPort, httpsPort);
  await Promise.all(domains.map(async it=>await server.addServer(it)));
  ca.push(await fs.readFile('test/ca.cert'));
});

describe('domain1', ()=>{
  describe('domain1.com', ()=>{
    it('http head request to domain1.com', async()=>{
      const response = await request(`http://domain1.com:${httpPort}`, Methods.head);
      assert.strictEqual(response.status, 301);
      assert.strictEqual(response.headers.get('location'), `https://domain1.com:${httpsPort}/`);
    });
    it('http head request to domain1.com/', async()=>{
      const response = await request(`http://domain1.com:${httpPort}/`, Methods.head);
      assert.strictEqual(response.status, 301);
      assert.strictEqual(response.headers.get('location'), `https://domain1.com:${httpsPort}/`);
    });
    it('http head request to domain1.com/test', async()=>{
      const response = await request(`http://domain1.com:${httpPort}/test`, Methods.head);
      assert.strictEqual(response.status, 301);
      assert.strictEqual(response.headers.get('location'), `https://domain1.com:${httpsPort}/test`);
    });
    it('https (HTTP2) head request to domain1.com/fake/path', async()=>{
      const response = await request(`https://domain1.com:${httpsPort}/fake/path`, Methods.head);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('x-test'), `test`);
      assert.strictEqual(response.headers.get('content-type'), 'application/json');
      assert.strictEqual(response.body.length, 0);
    });
    it('https (HTTP2) get request to domain1.com/fake/path', async()=>{
      const response = await request(`https://domain1.com:${httpsPort}/fake/path`, Methods.get);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('x-test'), `test`);
      assert.strictEqual(response.headers.get('content-type'), 'application/json');
      const body = JSON.parse(response.body.toString());
      assert.strictEqual(body.name, 'domain1');
      assert.strictEqual(body.hostname, 'domain1.com');
      assert.strictEqual(body.method, 'get');
      assert.strictEqual(body.url, '/fake/path');
    });
    it('https (HTTP1.1) get request to domain1.com/fake/path', async()=>{
      const response = await request(`https://domain1.com:${httpsPort}/fake/path`, Methods.get, true);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('x-test'), `test`);
      assert.strictEqual(response.headers.get('content-type'), 'application/json');
      const body = JSON.parse(response.body.toString());
      assert.strictEqual(body.name, 'domain1');
      assert.strictEqual(body.hostname, 'domain1.com');
      assert.strictEqual(body.method, 'get');
      assert.strictEqual(body.url, '/fake/path');
    });
    describe('update certificate', ()=>{
      it('call to update_certificate should fail', async()=>{
        const response = await request(`http://domain1.com:${httpPort}/update_certificate`, Methods.get, true);
        assert.strictEqual(response.status, 500);
      });
    });
  });
  describe('www.domain1.com', ()=>{
    it('http head request to www.domain1.com', async()=>{
      const response = await request(`http://www.domain1.com:${httpPort}`, Methods.head);
      assert.strictEqual(response.status, 301);
      assert.strictEqual(response.headers.get('location'), `https://www.domain1.com:${httpsPort}/`);
    });
    it('http head request to www.domain1.com/', async()=>{
      const response = await request(`http://www.domain1.com:${httpPort}/`, Methods.head);
      assert.strictEqual(response.status, 301);
      assert.strictEqual(response.headers.get('location'), `https://www.domain1.com:${httpsPort}/`);
    });
    it('http head request to www.domain1.com/test', async()=>{
      const response = await request(`http://www.domain1.com:${httpPort}/test`, Methods.head);
      assert.strictEqual(response.status, 301);
      assert.strictEqual(response.headers.get('location'), `https://www.domain1.com:${httpsPort}/test`);
    });
    it('https (HTTP2) head request to www.domain1.com/fake/path', async()=>{
      const response = await request(`https://www.domain1.com:${httpsPort}/fake/path`, Methods.head);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('x-test'), `test`);
      assert.strictEqual(response.headers.get('content-type'), 'application/json');
      assert.strictEqual(response.body.length, 0);
    });
    it('https (HTTP2) get request to www.domain1.com', async()=>{
      const response = await request(`https://www.domain1.com:${httpsPort}`, Methods.get);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('x-test'), `test`);
      assert.strictEqual(response.headers.get('content-type'), 'application/json');
      const body = JSON.parse(response.body.toString());
      assert.strictEqual(body.name, 'domain1');
      assert.strictEqual(body.hostname, 'www.domain1.com');
      assert.strictEqual(body.method, 'get');
      assert.strictEqual(body.url, '/');
    });
    it('https (HTTP2) get request to www.domain1.com/', async()=>{
      const response = await request(`https://www.domain1.com:${httpsPort}/`, Methods.get);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('x-test'), `test`);
      assert.strictEqual(response.headers.get('content-type'), 'application/json');
      const body = JSON.parse(response.body.toString());
      assert.strictEqual(body.name, 'domain1');
      assert.strictEqual(body.hostname, 'www.domain1.com');
      assert.strictEqual(body.method, 'get');
      assert.strictEqual(body.url, '/');
    });
    it('https (HTTP2) get request to www.domain1.com/fake/path', async()=>{
      const response = await request(`https://www.domain1.com:${httpsPort}/fake/path`, Methods.get);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('x-test'), `test`);
      assert.strictEqual(response.headers.get('content-type'), 'application/json');
      const body = JSON.parse(response.body.toString());
      assert.strictEqual(body.name, 'domain1');
      assert.strictEqual(body.hostname, 'www.domain1.com');
      assert.strictEqual(body.method, 'get');
      assert.strictEqual(body.url, '/fake/path');
    });
    it('https (HTTP1.1) get request to www.domain1.com/fake/path', async()=>{
      const response = await request(`https://www.domain1.com:${httpsPort}/fake/path`, Methods.get, true);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('x-test'), `test`);
      assert.strictEqual(response.headers.get('content-type'), 'application/json');
      const body = JSON.parse(response.body.toString());
      assert.strictEqual(body.name, 'domain1');
      assert.strictEqual(body.hostname, 'www.domain1.com');
      assert.strictEqual(body.method, 'get');
      assert.strictEqual(body.url, '/fake/path');
    });
    describe('update certificate', ()=>{
      it('call to update_certificate should fail', async()=>{
        const response = await request(`http://www.domain1.com:${httpPort}/update_certificate`, Methods.get, true);
        assert.strictEqual(response.status, 500);
      });
    });
  });
});
describe('domain2', ()=>{
  describe('domain2.com', ()=>{
    it('http head request to domain2.com', async()=>{
      const response = await request(`http://domain2.com:${httpPort}`, Methods.head);
      assert.strictEqual(response.status, 301);
      assert.strictEqual(response.headers.get('location'), `https://domain2.com:${httpsPort}/`);
    });
    it('https get request to domain2.com', async()=>{
      const response = await request(`https://domain2.com:${httpsPort}`, Methods.get);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.length, 0);
    });
  });
  describe('www.domain2.com', ()=>{
    it('http head request to www.domain2.com', async()=>{
      const response = await request(`http://www.domain2.com:${httpPort}`, Methods.head);
      assert.strictEqual(response.status, 301);
      assert.strictEqual(response.headers.get('location'), `https://www.domain2.com:${httpsPort}/`);
    });
    it('https get request to www.domain2.com', async()=>{
      const response = await request(`https://www.domain2.com:${httpsPort}`, Methods.get);
      assert.strictEqual(response.status, 301);
      assert.strictEqual(response.headers.get('location'), `https://domain2.com:${httpsPort}/`);
    });
  });
});

after(async ()=>{
  await server.close();
});
