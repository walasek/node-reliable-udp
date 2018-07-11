const glob = require('glob');
const path = require('path');
const test = require('zora');

function runTestFile(file){
	test('Testing file '+file, (t) => {
		require(path.resolve(file));
	});
}

if(process.argv[2])
	return runTestFile(process.argv[2]);

glob.sync('./tests/**/*.test.js').forEach(runTestFile);