const ReliableSocket = require('../socket');
const unreliablizeSocket = require('./socket.mockup');
const Session = require('../session');
const Timeout = require('../timeout');
const XBuffer = require('../infinite-buffer');

module.exports = async function(test){
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

	await test('Can bind to a random port and close', async (t) => {
		const host = new ReliableSocket();
		await host.bind();
		t.ok(host.port != 0, 'Port has been set ('+host.port+')');
		await host.close();
	});

	await test('Can discover self', async (t) => {
		const host = new ReliableSocket();
		await host.bind();
		const me = await host.discoverSelf();
		t.ok(me[0], 'An IP address was retrieved');
		t.ok(me[1], 'A port number was retrieved');
		await host.close();
	});

	await test('A basic connection can be made', async (t) => {
		const h1 = new ReliableSocket();
		const h2 = new ReliableSocket();
		await h1.bind();
		await h2.bind();
		const sess1 = await h1.connect('127.0.0.1', h2.port);
		t.ok(sess1 instanceof Session);
		await new Promise((res) => setTimeout(res, 500));
		t.ok(Object.keys(h1.sessions).length > 0, 'Host H1 has sessions');
		t.ok(Object.keys(h2.sessions).length > 0, 'Host H2 has sessions');
		const sess2 = h2.sessions[Object.keys(h2.sessions)[0]];
		await t.test('Hosts can communicate (H1 -> H2)', async (t) => {
			return new Promise((res, rej) => {
				const d1 = Buffer.from([1, 2, 3]);
				const d2 = Buffer.from([4, 5, 6]);
				const guard = new Timeout(500, () => rej('Timeout'));
				sess2.once('data', (data) => {
					t.equal(data[0], d1[0]);
					t.equal(data[0], 1);
					t.equal(data[1], d1[1]);
					t.equal(data[1], 2);
					t.equal(data[2], d1[2]);
					t.equal(data[2], 3);

					sess2.once('data', (data) => {
						if(!guard.enterGate())return;
						t.equal(data[0], d2[0]);
						t.equal(data[0], 4);
						t.equal(data[1], d2[1]);
						t.equal(data[1], 5);
						t.equal(data[2], d2[2]);
						t.equal(data[2], 6);
						res();
					});
					sess1.sendBuffer(d2);
				});
				sess1.sendBuffer(d1);
			});
		});
		await t.test('Hosts can communicate (H2 -> H1)', async (t) => {
			return new Promise((res, rej) => {
				const d1 = Buffer.from([1, 2, 3]);
				const d2 = Buffer.from([4, 5, 6]);
				const guard = new Timeout(500, () => rej('Timeout'));
				sess1.once('data', (data) => {
					t.equal(data[0], d1[0]);
					t.equal(data[0], 1);
					t.equal(data[1], d1[1]);
					t.equal(data[1], 2);
					t.equal(data[2], d1[2]);
					t.equal(data[2], 3);

					sess1.once('data', (data) => {
						if(!guard.enterGate())return;
						t.equal(data[0], d2[0]);
						t.equal(data[0], 4);
						t.equal(data[1], d2[1]);
						t.equal(data[1], 5);
						t.equal(data[2], d2[2]);
						t.equal(data[2], 6);
						res();
					});
					sess2.sendBuffer(d2);
				});
				sess2.sendBuffer(d1);
			});
		});
		await t.test('Hosts can exchange data buffers exceeding the MTU size', async (t) => {
			return new Promise((res, rej) => {
				const d1 = Buffer.alloc(10000);
				for(let i = 0; i < d1.length; i++)
					d1[i] = i % 256;
				const recv = new XBuffer();
				const guard = new Timeout(500, () => rej('Did not receive the transfer in expected time'));
				sess2.on('data', (data) => {
					if(!guard.isActive())return;
					recv.append(data);
					if(recv.getLength() == d1.length){
						for(let i = 0; i < d1.length; i++){
							if(d1[i] != recv.get(i))
								return rej(`Invalid data received at index ${i}`);
						}
						t.equal(recv.getLength(), d1.length);
						const reconstruct = recv.splice(recv.getLength());
						t.equal(Buffer.compare(d1, reconstruct), 0);
						res();
					}
				});
				sess1.sendBuffer(d1);
			});
		});
		await h1.close();
		await h2.close();
	});

	await test('Communication across lossy links can still be supported', async (t) => {
		async function _doLossyTest(loss_chance){
			const h1 = new ReliableSocket();
			const h2 = new ReliableSocket();
			await t.test('Lossy communication @ '+(loss_chance*100)+'%', async (t) => {
				return new Promise(async (res, rej) => {
					await h1.bind();
					await h2.bind();
					const sess1 = await h1.connect('127.0.0.1', h2.port);
					t.ok(sess1 instanceof Session);
					await new Promise((res) => setTimeout(res, 500));
					unreliablizeSocket(h1.socket, {loss: loss_chance});
					unreliablizeSocket(h2.socket, {loss: loss_chance});
					const sess2 = h2.sessions[Object.keys(h2.sessions)[0]];
					const MESSAGES = 100;
					const buf = Buffer.alloc(MESSAGES);
					const recv = Buffer.alloc(MESSAGES);
					let recv_off = 0;
					const guard = new Timeout(500, () => rej('Communication failed'));
					for(let i = 0; i < buf.length; i++)
						buf[i] = (Math.random()*255) >>> 0;
					for(let i = 0; i < MESSAGES; i++)
						sess1.sendBuffer(Buffer.from([buf[i]]));
					sess2.on('data', (data) => {
						if(!guard.isActive())return;
						data.copy(recv, recv_off);
						recv_off += data.length;
						if(recv_off >= MESSAGES){
							// Done.
							res();
						}
					});
				});
			});
			await h1.close();
			await h2.close();
		}
		await _doLossyTest(0);
		await _doLossyTest(0.05);
		await _doLossyTest(0.1);
		await _doLossyTest(0.15);
	});
};