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
 * @param {Object<string,string>?} extraHeaders
 * @returns {Promise<Response>}
 */
const request=(url,method=Methods.get,extraHeaders)=>new Promise((resolve,reject)=>{
  if(extraHeaders) options.headers = extraHeaders;
  const i = url.indexOf('://');
  const proto = url.substring(0,i);
  const j = url.indexOf('/', i+3);
  const authority = j===-1 ? url.substring(i+3) : url.substring(i+3,j);
  const path = j===-1 ? '/' : url.substring(j);
  const [ request, close ] = (()=>{
    if(proto==='http'){
      const k = authority.indexOf(':');
      const hostname = k===-1 ? authority : authority.substring(0, k);
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
      const session = http2.connect(`${proto}://${authority}`, { rejectUnauthorized: false });
      const request = session.request({
        ':method': method.toUpperCase(),
        ':path': path
      });
      return [ request, ()=>session.close() ];
    }
  })();
  const data = [];
  let status = 0;
  let headers = new Map();
  let error = undefined;
  request.on('error', e=>error=e);
  request.on('response', it=>{
    if(proto==='http'){
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

const handler = (request,response,hostname,remoteAddress,local,serverInstance)=>{
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.write(JSON.stringify({
    method: request.method.toLowerCase(),
    url: request.url,
    remoteAddress: remoteAddress,
    local: local,
    server: serverInstance === server
  }));
  response.end();
};

const domain1 = {
  hostnames: [ 'domain1.com', 'www.domain1.com' ],
  key: {
    path: 'test/data/domain1.key'
  },
  cert: {
    path: 'test/data/domain1.cert'
  },
  handler: handler
};
const domains = [
  domain1
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
  await Promise.all(domains.map(it=>server.addServer(it)));
});

describe('Test domains', ()=>{
  it('should call us', async()=>{
    const response = await request(`https://domain1.com:${httpsPort}`, Methods.get);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get('content-type'), 'application/json');
    const body = JSON.parse(response.body.toString());
    assert.strictEqual(body.method, 'get');
  });
});

after(async ()=>{
  await server.close();
});
