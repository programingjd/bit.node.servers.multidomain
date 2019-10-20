[![Node.js version](https://img.shields.io/badge/node-%3E%3D10.0-blue)](https://nodejs.org)
[![Bit.dev package](https://img.shields.io/badge/%20bit%20-programingjd.node%2Fservers%2Fmultidomain-blueviolet)](https://bit.dev/programingjd/node/servers/multidomain)
[![GitHub package.json version](https://img.shields.io/github/package-json/v/programingjd/bit.node.servers.multidomain)](https://bit.dev/programingjd/node/servers/multidomain)
[![GitHub](https://img.shields.io/github/license/programingjd/bit.node.servers.multidomain)](LICENSE)
![Travis (.org)](https://img.shields.io/travis/programingjd/bit.node.servers.multidomain)
![Coveralls github](https://img.shields.io/coveralls/github/programingjd/bit.node.servers.multidomain)

Node.js module.

HTTPS server with support for multiple domains with different certificates.

HTTP requests redirect to HTTPS with the HSTS header.

Requests are upgraded to HTTP2 requests if the client supports it.

There's a special endpoint to trigger a renewall of the certificates from let's encrypt.


## Usage

```javascript
const Server = require('@bit/programingjd.node.servers.multidomain');
const server = Server();
const handler = (request, response, hostname, remoteAddress, serverInstance)=>{
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.write(`Request from ${remoteAddress} to ${hostname}\n`);
  response.end(`Hostnames served: ${serverInstance.hostnames()}`);
};
(async()=>{
  await server.addServer(
    {
      hostnames: [ 'mydomain.com', 'www.mydomain.com' ],
      key: {
        path: 'path/to/domain/certificate/key'
      },
      cert: {
        path: 'path/to/domain/certificate'
      },
      handler: handler
    }
  );
})();
```


The `addServer` async function takes a server object, representing a list of domains served
with the same certificate.


The server object has these properties:

  - `hostnames` (required)
  
    the list of domain names that the certificate covers
    
  - `key.path` (required)
    
    the path to the certificate key
    
  - `cert.path` (required)
  
    the path to the certificate
    
  - `acme.email` (optional)
  
    the email of a [Let's Encrypt](https://letsencrypt.org) account

  - `handler` (required)
  
    the function called to handle the requests
    
    

The handler function has these parameters:

  - `request`
  
    the request object
    
  - `response`
  
    the response object
    
  - `hostname`
  
    the hostname from the request url
    
  - `remoteAddress`
  
    the ip address the request originates from 
    (`'127.0.0.1'` for a request made from the same host)

  - `server`
  
    the (multi domain) server instance
  
    
## Certificate updates

  If the certificate is issued by [Let's Encrypt](https://letsencrypt.org), you can make use of the
  special endpoint to trigger a certificate update. The new certificates are replaced on the fly and
  the server doesn't need to be restarted.
  
  Note that the optional `acme.email` property on the server object is used as the email for the
  account when requesting certificate updates. Therefore, the request will fail if this was not
  specified.
  
  The endpoint is `/update_certificate`. It needs to be called via http (not https) and it only works
  on the same host. It also needs to be called for each server object.
  
  E.g. http://domain1.com/update_certificate
  
  This endpoint returns a `200 OK` response when the update succeeds and a `500 Internal Server Error`
  when it doesn't.
  
  
## Running the server with Systemd

  The server supports running via [Systemd](https://github.com/systemd/systemd) with socket activation.
 
  This is very useful for binding to port 80 and 443.
  
  You should not specify the http and https ports in the Server constructor when you intend to bind to
  systemd activated sockets. The http server will bind to the first activated socket and the https server
  will bing to the second.
  
  Example configuration:
  
  MyServer.service
  ```
  [Unit]
  Description=nodejs multiserver
  After=network.target

  [Service]
  Type=simple
  User=www-data
  Group=www-data
  WorkingDirectory=/home/admin/myserver
  ExecStart=/usr/bin/node myserver.js
  NonBlocking=true
  Restart=on-failure
  RestartSec=15s

  [Install]
  WantedBy=multi-user.target
  ```

  MyServer.socket
  ```
  [Socket]
  ListenStream=80
  ListenStream=443
  NoDelay=true
  
  [Install]
  WantedBy=sockets.target
  ```


  You can also have the certificates renewed by Systemd timers.
  Remember that you need to call the update_certificate endpoint for each group of domains handled by
  the same certificate.
  
  Domain1CertificateRenewal.service
  ```
    [Unit]
    Description=domain1.com certificate renewal
    Wants=Domain1CertificateRenewal.timer
    
    [Service]
    ExecStart=/usr/bin/curl "http://domain1.com/update_certificate"
    WorkingDirectory=/home/admin
    
    [Install]
    WantedBy=multi-user.target
  ```
  
  Domain1CertificateRenewal.timer
  ```
    [Unit]
    Description=Runs domain1.com certificate renewal every week
    Requires=Domain1CertificateRenewal.service
    
    [Timer]
    Unit=Domain1CertificateRenewal.service
    OnBootSec=5min
    OnUnitInactiveSec=1w
    RandomizedDelaySec=12h
    AccuracySec=1h
    
    [Install]
    WantedBy=timers.target
  ```
