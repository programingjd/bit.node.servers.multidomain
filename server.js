const fs=require('fs').promises;
const http=require('http');
const http2=require('http2');
const tls=require('tls');
const dns=require('dns');
const acme=require('acme-client');

const systemdFirstSocket=()=>{
  if(process.env.LISTEN_FDS) return { fd: 3 };
};
const systemdSecondSocket=()=>{
  if(process.env.LISTEN_FDS) return { fd: 4 };
};

const addr=it=>{
  if(it.length<5) return null;
  if(it.charAt(0)===':'&&it.length>13&&it.charAt(1)===':'&&it.charAt(2)==='f'&&it.charAt(3)==='f'&&
     it.charAt(4)==='f'&&it.charAt(5)==='f'&&it.charAt(6)===':'&&
     (it.charAt(8)==='.'||it.charAt('9')==='.'||it.charAt('10')==='.')) return it.substring(7);
  return it;
};
const noPort=it=>{
  const n=it.length-1;
  if(n<2) return it;   // a:1  n=2
  for(let i=1;i<6&&i<n;++i){
    const c=it.charAt(n-i);
    if(c===':') return it.substring(0,n-i);
    if(c<0||c>9) return it;
  }
  return it;
};
const host=request=>{
  const host=request.headers.host;
  if(host===undefined){
    const i0=request.url.indexOf('http://');
    if(i0!==0) return null;
    try{return new URL(request.url).hostname;}catch(e){return null;}
  } else return noPort(host.toLowerCase());
};
/**
 * @namespace MultiDomainServer
 * @param {number} [httpPort=80]
 * @param {number} [httpsPort=443]
 * @constructor
 */
module.exports=(httpPort,httpsPort)=>{
  if(!httpPort) httpPort=systemdFirstSocket()||80;
  if (!httpsPort) httpsPort=systemdSecondSocket()||443;
  const localAddresses=new Set(['127.0.0.1','::1']);
  const http01='/.well-known/acme-challenge/';
  const servers={};
  const server={};
  /**
   * @template T
   * @param {http2.Http2ServerRequest} request
   * @param {http2.Http2ServerResponse} response
   * @param {string} hostname
   * @param {string} remoteAddress,
   * @param {array<{
   *   accept:function(
   *     request:http2.Http2ServerRequest,
   *     response:http2.Http2ServerResponse,
   *     hostname:string,
   *     remoteAddress:string
   *   ):T,
   *   handle(acceptor:T)}>
   * } handlers
   */
  const defaultHandler=(request,response,hostname,remoteAddress,handlers)=>{
    for(const handler of handlers){
      const accepted=handler.accept(request,response,hostname,remoteAddress);
      if(accepted) return handler.handle(accepted);
    }
    response.writeHead(404);
    response.end();
  };
  const httpServer=http.createServer(
    (request,response)=>{
      const remoteAddress=addr(request.socket.remoteAddress);
      const hostname=host(request);
      if(!servers[hostname]) return request.socket.end();
      const path=request.url;
      if(path.indexOf(http01)===0){
        const token=(servers[hostname].acme||{}).token;
        if(path.substring(http01.length)===token){
          response.writeHead(200);
          response.end((servers[hostname].acme||{}).key);
        }else{
          response.writeHead(404);
          response.end();
        }
      }else if(localAddresses.has(remoteAddress)&&path==='/update_certificate'){
        (async ()=>{
          try{
            if(await server.updateCertificate(servers[hostname].hostnames[0])){
              response.writeHead(200);
              response.end();
            }
            else{
              response.writeHead(500,{'Content-Type':'text/plain'});
              response.end();
            }
          }
          catch(err){
            response.writeHead(500,{'Content-Type':'text/plain'});
            response.end(err.message);
          }
        })();
      }else{
        const redirect=`https://${hostname}${(httpsPort===443||typeof httpsPort==='object')?'':':'+httpsPort}${path}`;
        response.writeHead(
          301,
          { Location: redirect, 'Strict-Transport-Security': 'max-age=86400' }
        );
        response.end();
      }
    }
  );
  const httpsServer=http2.createSecureServer(
    {
      allowHTTP1: true,
      key: null,
      cert: null,
      minVersion: 'TLSv1.2',
      SNICallback: (domain,cb)=>{
        const server=servers[domain];
        if(server) cb(null,server.context);
        else cb();
      }
    },
    (request,response)=>{
      response.sendDate=true;
      const remoteAddress=addr(request.socket.remoteAddress);
      const hostname=request.socket.servername;
      try{
        const it=servers[hostname];
        it.handler(
          request,
          response,
          hostname,
          remoteAddress,
          it.handlers
        );
      }
      catch(err){
        console.log(err);
        if(response.headersSent) response.end();
        else{
          response.writeHead(500);
          response.end();
        }
      }
    }
  );
  httpsServer.on('secureConnection',(socket)=>{
    if(!servers[socket.servername]) socket.disconnect();
  });
  /**
   * @param {string} address
   * @returns {boolean}
   */
  server.isLocal=address=>localAddresses.has(address);
  /**
   * @type {number}
   */
  server.httpPort=httpPort;
  /**
   * @type {number}
   */
  server.httpsPort=httpsPort;
  /**
   * @returns {string[]}
   */
  server.hostnames=()=>{
    const set=new Set();
    Object.values(servers).forEach(it=>it.hostnames.forEach(it=>set.add(it)));
    return [...set.values()];
  }
  /**
   * @async
   * @template T
   * @param {
   * {
   *   handler:function(
   *     request:http2.Http2ServerRequest,
   *     response:http2.Http2ServerResponse,
   *     hostname:string,
   *     remoteAddress:string,
   *     handlers:array<{
   *       accept:function(
   *         request:http2.Http2ServerRequest,
   *         response:http2.Http2ServerResponse,
   *         hostname:string,
   *         remoteAddress:string,
   *         handlers:array<{
   *           accept:function(
   *             request:http2.Http2ServerRequest,
   *             response:http2.Http2ServerResponse,
   *             hostname:string,
   *             remoteAddress:string
   *           ):T,
   *           handle(acceptor:T)
   *         }>
   *       ):T,
   *       handle(acceptor:T)
   *     }>
   *   ),
   *   handlers:array<{
   *     accept:function(
   *       request:http2.Http2ServerRequest,
   *       response:http2.Http2ServerResponse,
   *       hostname:string,
   *       remoteAddress:string
   *     ):T,
   *     handle(acceptor:T)
   *   }>,
   *   acme:{email:string},
   *   hostnames:string[],
   *   cert:{path:string},
   *   key:{path:string}}
   * } server
   */
  server.addServer=async server=>{
    const keyData=await fs.readFile(server.key.path);
    const certData=await fs.readFile(server.cert.path);
    server.hostnames.map(hostname=>{
      return servers[hostname]={
        hostnames: server.hostnames,
        key: {
          path: server.key.path
        },
        cert: {
          path: server.cert.path
        },
        acme: {
          email: (server.acme||{}).email
        },
        handler: server.handler||defaultHandler,
        handlers: server.handlers||[],
        context: tls.createSecureContext({
          key: keyData,
          cert: certData,
          minVersion: 'TLSv1.2'
        })
      };
    });
    await Promise.all(
      server.hostnames.map(async hostname=>{
        await new Promise(r=>{
          dns.resolve4(hostname,(err,addresses)=>{
            if(!err) addresses.forEach(it=>localAddresses.add(addr(it)));
            r();
          });
        });
        await new Promise(r=>{
          dns.resolve6(hostname,(err,addresses)=>{
            if(!err) addresses.forEach(it=>localAddresses.add(addr(it)));
            r();
          });
        });
      }),
    );
  };
  let httpStarted=false;
  let httpssStarted=false;
  server.close=()=>{
    const promises=[new Promise(r=>r())];
    if(!httpStarted) httpStarted=true; else promises.push(new Promise(r=>httpServer.close(r)));
    if(!httpssStarted) httpssStarted=true; promises.push(new Promise(r=>httpsServer.close(r)));
    return Promise.all(promises);
  };
  /**
   * @async
   * @param {string} hostname
   * @returns {Promise<boolean>}
   */
  server.updateCertificate=async hostname=>{
    if(!servers[hostname])return false;
    const email=servers[hostname].acme.email;
    const hostnames=servers[hostname].hostnames;
    if(!email)return false;
    const accountKey=await acme.forge.createPrivateKey();
    const [key,csr]=await acme.forge.createCsr(
      [hostnames.slice(0)].map(it=>{
        return {
          commonName: it.shift(),
          altNames: it
        };
      })[0]
    );
    const client=new acme.Client({
      directoryUrl: acme.directory.letsencrypt.production,
      accountKey: accountKey
    });
    const account=await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [ `mailto:${email}` ]
    });
    console.log('account',account);
    const order=await client.createOrder({
      identifiers: hostnames.map(it=>{
        return { type: 'dns', value: it }
      })
    });
    const authorizations=await client.getAuthorizations(order);
    console.log('authorizations', authorizations);
    for(let i=0; i<authorizations.length; ++i){
      const authorization=authorizations[i];
      const challenge=authorization.challenges.find(it=>it.type==='http-01');
      console.log('challenge',challenge);
      const hostname=authorization.identifier.value;
      const server=servers[hostname];
      server.acme.key=await client.getChallengeKeyAuthorization(challenge);
      server.acme.token=challenge.token;
      console.log('key',server.acme.key);
      await client.verifyChallenge(authorization,challenge);
      console.log('verified');
      await client.completeChallenge(challenge);
      console.log('completed');
      await client.waitForValidStatus(challenge);
      console.log('validated');
      server.acme.key=null;
      server.acme.token=null;
    }
    await client.finalizeOrder(order,csr);
    console.log('finalized');
    const cert=await client.getCertificate(order);
    hostnames.forEach(it=>{
      const server=servers[it];
      server.context=tls.createSecureContext({
        key: key,
        cert: cert,
        minVersion: 'TLSv1.2'
      });
    });
    await fs.writeFile(servers[hostname].key.path,key);
    await fs.writeFile(servers[hostname].cert.path,cert);
    return true;
  };
  if(!httpStarted){
    httpServer.listen(httpPort,err=>{
      if(err) return console.log(err);
      if(httpStarted) httpServer.close(); else httpStarted=true;
    });
  }
  if(!httpssStarted){
    httpsServer.listen(httpsPort,err=>{
      if(err) return console.log(err);
      if(httpssStarted) httpsServer.close(); else httpssStarted=true;
    });
  }
  Object.freeze(server);
  return server;
};
