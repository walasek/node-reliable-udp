const test = require('zora');
const ReliableSocket = require('../socket');
const SocketMockup = require('./socket.mockup');

test('Sockets use a random seed', (t) => {
	const h1 = new ReliableSocket();
	const h2 = new ReliableSocket();
	t.notEqual(h1.seed, h2.seed);
	t.test('Sessions have different hashes for every instance', (t) => {
		const addr = {address: '127.0.0.1', port: 123};
		const hash1 = h1.rinfoToHash(addr);
		const hash2 = h2.rinfoToHash(addr);
		t.notEqual(Buffer.compare(hash1, hash2), 0);
	});
});

test('Socket gracefuly handles invalid packets without affecting state', (t) => {
	const host = new ReliableSocket();
	const addr = {address: '127.0.0.1', port: 123};
	host.handleDatagram(Buffer.from([66,2,3]), addr);
	t.notOk(Object.keys(host.sessions) > 0);
});

test('Can bind to a random port and close', async (t) => {
	const host = new ReliableSocket();
	await host.bind();
	t.ok(host.port != 0, 'Port has been set ('+host.port+')');
	await host.close();
});

test('Can discover self', async (t) => {
	const host = new ReliableSocket();
	await host.bind();
	const me = await host.discoverSelf();
	t.ok(me[0], 'An IP address was retrieved');
	t.ok(me[1], 'A port number was retrieved');
	await host.close();
});

test('A basic connection can be made', async (t) => {
	const h1 = new ReliableSocket();
	const h2 = new ReliableSocket();
	await h1.bind();
	await h2.bind();
	await h1.connect('127.0.0.1', h2.port);
	await new Promise((res) => setTimeout(res, 500));
	t.ok(Object.keys(h1.sessions).length > 0, 'Host H1 has sessions');
	t.ok(Object.keys(h2.sessions).length > 0, 'Host H2 has sessions');
	await h1.close();
	await h2.close();
});