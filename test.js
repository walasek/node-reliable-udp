const test = require('zora');
const lib = require('.');
const Timeout = require('./timeout');
const XBuffer = require('./infinite-buffer');

test('Infinite buffer', (t) => {
	t.test('Infinite buffer can store incremental data', (t) => {
		const buf = new XBuffer();
		buf.append(Buffer.from([1, 2, 3, 4, 5]));
		t.equal(buf.getLength(), 5, 'Buffer stored the data #1');
		buf.append(Buffer.from([6, 7, 8, 9, 10]));
		t.equal(buf.getLength(), 10, 'Buffer stored the data #2');
	});

	t.test('Infinite buffer lookup works properly', (t) => {
		const buf = new XBuffer();
		buf.append(Buffer.from([10, 20, 30, 40, 50]));
		const lup = buf.lookup();
		t.equal(lup[0], 10, 'Lookup allows determining potential message length');
	});

	t.test('Infinite buffer splice works properly', (t) => {
		const buf = new XBuffer();
		buf.append(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
		t.equal(buf.getLength(), 10, 'Buffer stored the data');
		let v;

		v = buf.splice(1);
		t.equal(v.length, 1, 'Splice is of proper length');
		t.equal(v[0], 1, 'Splice is of proper value');
		t.equal(buf.getLength(), 9, 'Buffer shrunk');

		v = buf.splice(1);
		t.equal(v.length, 1, 'Splice is of proper length');
		t.equal(v[0], 2, 'Splice is of proper value');
		t.equal(buf.getLength(), 8, 'Buffer shrunk');

		v = buf.splice(2);
		t.equal(v.length, 2, 'Splice is of proper length');
		t.equal(v[0], 3, 'Splice is of proper value');
		t.equal(v[1], 4, 'Splice is of proper value');
		t.equal(buf.getLength(), 6, 'Buffer shrunk');
	});

	t.test('Infinite buffer out of range splice is handled gracefuly', (t) => {
		const buf = new XBuffer();
		buf.append(Buffer.from([1, 2, 3]));
		let v = buf.splice(10);
		t.equal(v.length, 3, 'Splice took as much data as possible');
		t.equal(v[0], 1);
		t.equal(v[1], 2);
		t.equal(v[2], 3);
	});

	t.test('Infinite buffer lookup still possible after splicing', (t) => {
		const buf = new XBuffer();
		buf.append(Buffer.from([1, 1, 1]));
		buf.append(Buffer.from([5, 5]));
		buf.append(Buffer.from([2, 2, 2]));

		buf.splice(3);
		let v = buf.lookup();
		t.equal(v.length, 2);
		t.equal(v[0], 5);
		t.equal(v[1], 5);

		buf.splice(2);
		v = buf.lookup();
		t.equal(v.length, 3);
		t.equal(v[0], 2);
		t.equal(v[1], 2);
		t.equal(v[2], 2);
	});
});

test('Timeout gate', async (t) => {
	t.test('Timeout gate can handle timeouts', async (t) => {
		await new Promise((res, rej) => {
			const txo = setTimeout(() => {
				rej('Should never be called');
			}, 1000);
			const gate = new Timeout(500, () => {
				clearTimeout(txo);
			});
			setTimeout(res, 2000);
		});
	});
	t.test('Timeout can be dismissed', async (t) => {
		await new Promise((res, rej) => {
			const gate = new Timeout(1000, () => {
				rej('Should never be called');
			});
			const txo = setTimeout(() => {
				gate.dismiss();
			}, 500);
			setTimeout(res, 2000);
		});
	});
	t.test('Timeout enterGate works properly before timeout', async (t) => {
		await new Promise((res, rej) => {
			const gate = new Timeout(1000, () => {
				rej('Should never be called');
			});
			setTimeout(() => {
				if(!gate.enterGate()){
					rej('Should never be called');
				}
			});
			setTimeout(res, 2000);
		});
	});
	t.test('Timeout enterGate works properly after timeout', async (t) => {
		await new Promise((res, rej) => {
			const gate = new Timeout(500, () => {});
			setTimeout(() => {
				if(!gate.enterGate()){
					res();
				}
				rej('Should never be called');
			}, 1000);
		});
	});
});

test('Can bind to a random port and close', async (t) => {
	const udp = new lib();
	await udp.bind();
	t.ok(udp.port != 0, 'Port has been set ('+udp.port+')');
	await udp.close();
});

test('Can discover self', async (t) => {
	const udp = new lib();
	await udp.bind();
	const me = await udp.discoverSelf();
	t.ok(me[0], 'An IP address was retrieved');
	t.ok(me[1], 'A port number was retrieved');
});