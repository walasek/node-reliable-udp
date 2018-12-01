# DEPRECATED
## This library is deprecated in favor of [node-udp-messaging](https://github.com/walasek/node-udp-messaging) which has defined more managable goals.

Current state of this library does not allow stable transfers of big ammounts of data.

# [node-reliable-udp](https://github.com/walasek/node-reliable-udp) [![Build Status](https://img.shields.io/travis/walasek/node-reliable-udp.svg?style=flat-square)](https://travis-ci.org/walasek/node-reliable-udp) [![Package Version](https://img.shields.io/npm/v/reliable-udp.svg?style=flat-square)](https://www.npmjs.com/walasek/node-reliable-udp) ![License](https://img.shields.io/npm/l/reliable-udp.svg?style=flat-square) [![Dependencies](https://david-dm.org/walasek/node-reliable-udp.svg)](https://david-dm.org/walasek/node-reliable-udp.svg)  [![codecov](https://codecov.io/gh/walasek/node-reliable-udp/branch/master/graph/badge.svg)](https://codecov.io/gh/walasek/node-reliable-udp)

A reliable communication protocol over UDP with holepunching for Node.js.

---

## Goal

Implementing NAT holepunching with TCP is very tricky and does not work on every configuration. This project aims to deliver a tool to establish a reliable communication stream (TCP-like) over UDP for use in P2P systems. Communication stability has the priority over speed in this project.

## Installation

Node `>=8.9.0` is required.

```bash
npm install --save reliable-udp
```

To perform tests use:

```bash
cd node_modules/reliable-udp
npm t
```

## Usage

Beware this project is still in development. There may be serious bugs or performance issues over time.

```javascript
(async () => {
    // Create a reliable UDP socket
    const ReliableUDPSocket = require('reliable-udp');
    const server = new ReliableUDPSocket({ port: 12345 });
    await server.bind();

    // Connect to another peer
    const peer = await server.connect('192.168.0.15', 12345);

    // Send some raw data as a stream
    const data = Buffer.from("SomeGenericDataHere");
    peer.sendBuffer(data);

    // Receive raw data as a stream
    peer.on('data', (data) => {
        console.log(`Received: ${data}`);
    });

    // Execute holepunching (get an address and port that another peer over the internet can use to reach this peer)
    const hole = await server.discoverSelf();

    // Close a particular session
    peer.close();

    // Close all current sessions and unbind
    server.close();
})();
```

## Contributing

The source is documented with JSDoc. To generate the documentation use:

```bash
npm run docs
```

Extra debugging information is printed using the `debug` module:

```bash
DEBUG=reliable-udp:* npm t
```

The documentation will be put in the new `docs` directory.

To introduce an improvement please fork this project, commit changes in a new branch to your fork and add a pull request on this repository pointing at your fork. Please follow these style recommendations when working on the code:

* Use tabs (yup).
* Use `async`/`await` and/or `Promise` where possible.
* Features must be properly tested.
* New methods must be properly documented with `jscode` style comments.