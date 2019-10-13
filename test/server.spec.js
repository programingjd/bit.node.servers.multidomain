const http = require('http');
const https = require('https');
const assert = require('assert');
const server = require('../server');

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
 * @param {string} path
 * @param {Methods=} method
 * @param {Object<string,string>?} extraHeaders
 * @returns {Promise<Response>}
 */
const request=(path,method=Methods.get,extraHeaders)=>new Promise((resolve,reject)=>{
  const options = {
    host: 'localhost',
    port: port,
    path: path,
    method: method.toUpperCase()
  };
  if(extraHeaders) options.headers = extraHeaders;
  const request = http.request(options);
  const data = [];
  let status = 0;
  let headers = new Map();
  let error = undefined;
  request.on('error', e=>error=e);
  request.on('response', it=>{
    status = it.statusCode;
    Object.keys(it.headers).forEach(h=>{
      headers.set(h,it.headers[h]);
    });
    it.on('data', it=>data.push(it));
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
  });
  request.setTimeout(3000).end();
});


before(async()=>{

});

after(()=>{

});

