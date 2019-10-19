[![Node.js version](https://img.shields.io/badge/node-%3E%3D10.0-blue)](https://nodejs.org)
[![Bit.dev package](https://img.shields.io/badge/%20bit%20-programingjd.node%2Fservers%2Fmultidomain-blueviolet)](https://bit.dev/programingjd/node/servers/multidomain)
[![GitHub package.json version](https://img.shields.io/github/package-json/v/programingjd/bit.node.servers.multidomain)](https://bit.dev/programingjd/node/servers/multidomain)
[![GitHub](https://img.shields.io/github/license/programingjd/bit.node.servers.multidomain)](LICENSE)
![Travis (.org)](https://img.shields.io/travis/programingjd/bit.node.servers.multidomain)
![Coveralls github](https://img.shields.io/coveralls/github/programingjd/bit.node.servers.multidomain)

Node.js module.

HTTPS server with support for multiple domains with different certificates.

HTTP requests redirect to HTTPS with the HSTS header.

Serves files with HTTP1.1 or HTTP2 if the client supports it.

There's a special endpoint to trigger a renewall of the certificates from let's encrypt.


## Usage

```javascript
const server = require('@bit/programingjd.node.servers.multidomain');
const handler = (request, response, hostname, remoteAddress, serverInstance)=>{
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.write(`Request from ${remoteAddress} to ${hostname}\n`);
  response.end(`Hostnames served: ${serverInstance.hostnames()}`);
};
(async()=>{
  await server.addHandler(
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

