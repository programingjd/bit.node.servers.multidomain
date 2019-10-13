const fs=require('fs').promises;
const http=require('http');
const http2=require('http2');
const tls=require('tls');
const acme=require('acme-client');

const systemdFirstSocket=()=>{
  if(process.env.LISTEN_FDS) return { fd: 3 };
};
const systemdSecondSocket=()=>{
  if(process.env.LISTEN_FDS) return { fd: 4 };
};

/**
 * @namespace MultiDomainServer
 * @param {number} [httpPort=80]
 * @param {number} [httpsPort=443]
 * @constructor
 */
module.exports.MultiDomainServer=(httpPort,httpsPort)=>{
  if(!httpPort) httpPort=systemdFirstSocket()||80;
  if (!httpsPort) httpsPort=systemdSecondSocket()||443;
  const http01='/.well-known/acme-challenge/';
  const servers={};
  const multiServer={};
  let ip=null;
  acme.axios({
    method: 'get',
    url: 'https://ifconfig.co',
    headers: { Accept: '*/*', 'User-Agent': 'curl/7.52.1' },
    responseType: 'text'
  }).then(it=>ip=it.data.trim());
  const server=http.createServer(
    (request,response)=>{
      const remoteAddress=request.socket.remoteAddress.replace(/^::ffff:/,'');
      const hostname=request.headers.host;
      if(!servers[hostname]) return request.socket.end();
      const path=request.url;
      if(path.indexOf(http01)===0){
        const token=(servers[hostname].acme||{}).token;
        if(path.substring(http01.length)===token){
          response.writeHead(200).end((servers[hostname].acme||{}).key);
        }else{
          response.writeHead(404).end();
        }
      }else if(ip!==null&&ip===remoteAddress&&path==='/update_certificate'){
        (async ()=>{
          try{
            await multiServer.updateCertificate(hostname);
            response.writeHead(200).end();
          }
          catch(err){
            response.writeHead(500,{'Content-Type':'text/plain'}).end(err.message);
          }
        })();
      }else{
        const redirect=`https://${hostname}${httpsPort===443?'':':'+httpsPort}${path}`;
        response.writeHead(
          301,
          { Location: redirect, 'Strict-Transport-Security': 'max-age=86400' }
        ).end();
      }
    }
  );
  const tlsServer=http2.createSecureServer(
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
      const remoteAddress=request.socket.remoteAddress.replace(/^::ffff:/,'');
      const hostname=request.socket.servername;
      try{
        servers[hostname].handler(
          request,
          response,
          hostname,
          remoteAddress,
          ip!==null&&ip===remoteAddress,
          multiServer
        );
      }
      catch(err){
        if(response.headersSent) response.end();
        else response.writeHead(500).end();
      }
    }
  );
  tlsServer.on('secureConnection',(socket)=>{
    if(!servers[socket.servername]) socket.disconnect();
  });
  /**
   * @type {number}
   */
  multiServer.httpPort=httpPort;
  /**
   * @type {number}
   */
  multiServer.httpsPort=httpsPort;
  /**
   * @returns {string[]}
   */
  multiServer.servernames=()=>servers.flatMap(it=>it.hostnames);
  /**
   * @async
   * @param {
   * {
   *   handler:function(
   *     request:http2.Http2ServerRequest?,
   *     response:http2.Http2ServerResponse?,
   *     hostname:string?,
   *     remoteAddress:string?,
   *     local:boolean?,
   *     server:MultiDomainServer?
   *   ),
   *   acme:{email:string},
   *   hostnames:string[],
   *   cert:{path:string},
   *   key:{path:string}}
   * } server
   */
  multiServer.addServer=async server=>{
    const keyData=await fs.readFile(server.key.path);
    const certData=await fs.readFile(server.cert.path);
    await Promise.all(
      server.hostnames.map(async hostname=>{
        servers[hostname]={
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
          handler: server.handler,
          context: tls.createSecureContext({
            key: keyData,
            cert: certData,
            minVersion: 'TLSv1.2'
          })
        };
      })
    );
  };
  let started=false;
  let tlsStarted=false;
  multiServer.stop=()=>{
    if(!started) started=true; else server.stop();
    if(!tlsStarted) tlsStarted=true; else tlsServer.stop();
  };
  /**
   * @async
   * @param {string} hostname
   * @returns {Promise<void>}
   */
  multiServer.updateCertificate=async hostname=>{
    if(!servers[hostname])return;
    const email=servers[hostname].acme.email;
    const hostnames=servers[hostname].hostnames;
    if(!email)return;
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
  };
  if(!started){
    server.listen(httpPort,err=>{
      if(err) return console.log(err);
      if(started) server.close(); else started=true;
    });
  }
  if(!tlsStarted){
    tlsServer.listen(httpsPort,err=>{
      if(err) return console.log(err);
      if(tlsStarted) tlsServer.close(); else tlsStarted=true;
    });
  }
  Object.freeze(multiServer);
  return multiServer;
};
