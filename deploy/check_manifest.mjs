// Validate the published contract using the official CLI's installed dependencies/schema.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const modules = process.env.ZENITH_NODE_MODULES;
if (!modules) throw new Error('Set ZENITH_NODE_MODULES to the official CLI installation node_modules directory');
const require = createRequire(path.resolve(modules, '../package.json'));
const Ajv = require('ajv/dist/2020').default;
const formats = require('ajv-formats');
const yaml = require('yaml');
const cli = path.resolve(modules, '@zenith-hosting/cli/dist/lint');
const document = yaml.parse(fs.readFileSync('zenith-compose.yml', 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
formats(ajv);
const validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(cli, 'compose.schema.json'), 'utf8')));
if (!validate(document)) throw new Error(JSON.stringify(validate.errors));
const { validateComposeSemantics } = await import(pathToFileURL(path.join(cli, 'semantics.js')));
validateComposeSemantics(document);
if (fs.statSync('zenith-compose.yml').size > 128 * 1024) throw new Error('Manifest exceeds 128 KiB');
console.log('Official published schema and applicable CLI semantic checks passed. Preview policy and live runtime are separate checks.');
