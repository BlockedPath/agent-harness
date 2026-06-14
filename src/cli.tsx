#!/usr/bin/env node
import { render } from 'ink';
import dotenv from 'dotenv';
import { createCliProgram } from './cli-program.js';

dotenv.config();

await createCliProgram({ renderApp: (element) => render(element) }).parseAsync(process.argv);
