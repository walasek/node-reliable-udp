// node-reliable-udp
// Karol Walasek
// https://github.com/WalasPrime/node-reliable-udp
const debug_lib = require('debug');
const debug = debug_lib('reliable-udp:timeout');

const IS_DEBUGGING = debug_lib.enabled('reliable-udp:timeout') || true;

/**
 * @class
 * @description
 * A utility that allows easier handling of timeouts.
 */
class TimeoutGate {
	constructor(time, fn){
		this.watchdog = true;
		this.fn = fn;
		this.timeout = setTimeout(() => this.call(), time);
		if(IS_DEBUGGING){
			// Identify this timeout
			const stack = new Error().stack.split('\n');
			let id = 'Unidentified Timeout';
			if(stack.length >= 3)
				id = stack[2].substr(4);
			this.id = id;
			debug(`Timeout defined ${this.id} waiting ${time} ms`);
		}
	}
	/**
	 * @description
	 * Disable the timeout handler. Will prevent further calls.
	 */
	dismiss(){
		if(this.timeout)
			clearTimeout(this.timeout);
		this.timeout = null;
		if(this.watchdog  && IS_DEBUGGING)
			debug(`Timeout defined ${this.id} now dismissed`);
		this.watchdog = false;
	}
	/**
	 * @description
	 * Call the handler function. Allows only one call.
	 */
	call(){
		if(!this.watchdog)	// Just in case multiple calls were asynchronously queued.
			return;
		this.dismiss();
		debug(`Timeout defined ${this.id} now called!`);
		this.fn();
	}
	/**
	 * @description
	 * Returns if the timer is still running.
	 * @returns {boolean} True if the handling function was not called yet.
	 */
	isActive(){
		return this.watchdog;
	}
	/**
	 * @description
	 * A combination of {@link TimeoutGate#isActive} and {@link TimeoutGate#dismiss}. When this class is used with a function that reacts to an event with a timeout then this method should be used in the begining. It will properly dismiss the timer and not progress if the timeout function was already called for some reason.
	 * @example
	 * const guard = new TimeoutGate(100, () => { // Only wait for 100ms
	 * 	console.log('Waited too long for the operation to finish...');
	 * });
	 * myExpensiveAsyncOperation(() => {
	 * 	if(!guard.enterGate())return; // Results came too late, already handled the timeout
	 * 	console.log('Yay, got my results, and the timeout handler will not be called!');
	 * });
	 * @returns {boolean} True if this timeout gate did not call it's handling function yet.
	 */
	enterGate(){
		if(this.isActive()){
			this.dismiss();
			return true;
		}
		return false;
	}
}

module.exports = TimeoutGate;