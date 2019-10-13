const http = require('http');
const https = require('https');
const http2 = require('http2');
const assert = require('assert');
const Server = require('../server');

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
 * @param {string} domain
 * @param {string} path
 * @param {Methods=} method
 * @param {Object<string,string>?} extraHeaders
 * @returns {Promise<Response>}
 */
const request=(domain,path,method=Methods.get,extraHeaders)=>new Promise((resolve,reject)=>{
  if(extraHeaders) options.headers = extraHeaders;
  const session = http2.connect(domain, { rejectUnauthorized: false });
  const request = session.request({
    ':method': method.toUpperCase(),
    ':path': path
  });
  //const request = http2.request(url,options);
  const data = [];
  let status = 0;
  let headers = new Map();
  let error = undefined;
  request.on('error', e=>error=e);
  request.on('response', (it)=>{
    status = it[':status'];
    Object.keys(it).forEach(h=>{
      if(h[0]!==':') headers.set(h,it[h]);
    });
  });
  request.on('data', it=>data.push(it));
  request.on('close', ()=>{
    if (error) reject(error);
    resolve(
      {
        status: status,
        headers: headers,
        body: Buffer.concat(data)
      }
    );
    session.close();
  });
  request.setTimeout(1000).end();
});

let server;

const handler = (request,response,hostname,remoteAddress,local,serverInstance)=>{
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({
    method: request.method,
    url: request.url,
    port: request.port,
    remoteAddress: remoteAddress,
    local: local,
    server: serverInstance === server
  }));
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
  server = Server();
  await Promise.all(domains.map(it=>server.addServer(it)));
});

describe('Test domains', ()=>{
  it('should call us', async()=>{
    const response = await request('https://domain1.com', '/', Methods.head);
    console.log(response.headers);
    console.log(response.body.toString());
  });
});

after(async ()=>{
  await server.close();
});
