const test = require('zora');
const Timeout = require('../timeout');

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

