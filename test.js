const test = require('blue-tape');
const lib = require('.');
const Timeout = require('./timeout');

test('Timeout gate', async (t) => {
	t.test('Timeout gate can handle timeouts', (t) => {
		return new Promise((res, rej) => {
			const txo = setTimeout(() => {
				rej('Should never be called');
			}, 1000);
			const gate = new Timeout(500, () => {
				clearTimeout(txo);
			});
			setTimeout(res, 2000);
		});
	});
	t.test('Timeout can be dismissed', (t) => {
		return new Promise((res, rej) => {
			const gate = new Timeout(1000, () => {
				rej('Should never be called');
			});
			const txo = setTimeout(() => {
				gate.dismiss();
			}, 500);
			setTimeout(res, 2000);
		});
	});
	t.test('Timeout enterGate works properly before timeout', (t) => {
		return new Promise((res, rej) => {
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
	t.test('Timeout enterGate works properly after timeout', (t) => {
		return new Promise((res, rej) => {
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

test('Can discover self', async (t) => {
	const udp = new lib();
	const me = await udp.discoverSelf();
	t.assert(me[0], 'An IP address was retrieved');
	t.assert(me[1], 'A port number was retrieved');
});