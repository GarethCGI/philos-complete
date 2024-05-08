import 'dotenv/config'
import { GoogleSpreadsheet, GoogleSpreadsheetRow } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { drawConclusion, getColumnByHeaderName, getSheetByName, intoSeconds, readableDate } from './lib';
import fs from 'fs/promises';
import { sleep } from 'bun';

const creds = JSON.parse(await fs.readFile('config/credentials.json', 'utf-8'));

type CleanupMatcher = (c: string, a: string, o: string) => boolean;
const cleanupMatchers: CleanupMatcher[] = [
	(s, a) => { return s.includes('[]') || a.includes('[]') },
	(s, a) => { return s.includes('...') || a.includes('...') },
	(s, a) => { return s.includes('??') || a.includes('??') },
	(_s, _a, o) => { return o.includes('**') },
];

const ENV = {
	GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID,
	GEMINI_API_KEY: process.env.GEMINI_API_KEY,
} as { [key: string]: string };

for (const key in ENV) {
	if (!ENV[key]) {
		throw new Error(`Missing env var: ${key}`);
	}
}
const RATE_LIMIT = 1100;

// Initialize auth - see https://theoephraim.github.io/node-google-spreadsheet/#/guides/authentication
const serviceAccountAuth = new JWT({
	// env var values here are copied from service account credentials generated by google
	// see "Authentication" section in docs for more info
	email: creds.client_email,
	key: creds.private_key,
	scopes: [
		'https://www.googleapis.com/auth/spreadsheets',
	],
});

const doc = new GoogleSpreadsheet(ENV.GOOGLE_SHEET_ID, serviceAccountAuth);

await doc.loadInfo();
console.log(`Loaded doc: ${doc.title}`);

const HEADERS = {
	NUM: 'Número',
	CONCEPT: 'Concepto',
	ARG: 'Argumentos',
	OBSERVATIONS: 'Observaciones',
} as const;


const sheet = await getSheetByName(doc, 'Conceptos');

const rows = await sheet.getRows({
	limit: 1000,
});

// Find highest numbered row
let highest_row: GoogleSpreadsheetRow | undefined;
const highest_num = rows.reduce((acc, row) => {
	if (row.get(HEADERS.NUM) === '') {
		return acc;
	}
	const num = parseInt(row.get(HEADERS.NUM));
	if (isNaN(num)) {
		return acc;
	}
	if (num > acc) {
		highest_row = row;
	}
	return num > acc ? num : acc;
}, 0);

console.log(`Last populated row:[${highest_num}] ${highest_row?.get(HEADERS.NUM)}, ${highest_row?.get(HEADERS.CONCEPT)}`);

const start_time = Date.now();
console.log('Starting to process rows', readableDate(start_time));
for await (const row of rows) {
	const num = row.get(HEADERS.NUM);
	const concept = row.get(HEADERS.CONCEPT);
	const arg = row.get(HEADERS.ARG);
	const observations = row.get(HEADERS.OBSERVATIONS);

	// Use cleanup matchers to skip rows, and delete observations
	if (
		cleanupMatchers.some((matcher) => {
			return matcher(concept ?? "", arg ?? "", observations ?? "");
		})
	) {
		if (!observations) {
			console.log(`[${num}] Skipping row ${row.rowNumber} because of cleanup matchers`, `Elapsed time: ${intoSeconds(Date.now() - start_time)}`);
			continue;
		}
		console.log(`[${num}] Cleaning row ${row.rowNumber} because of cleanup matchers`, `Elapsed time: ${intoSeconds(Date.now() - start_time)}`);
		row.set(HEADERS.OBSERVATIONS, '');
		await row.save();
		continue;
	}

	// Skip if concept or argument is empty, or if observations are present, or if number is not a number
	if (!concept || !arg) {
		console.log(`[${num}] Skipping row ${row.rowNumber} because concept or argument is empty`, `Elapsed time: ${intoSeconds(Date.now() - start_time)}`);
		continue;
	}
	if (observations !== '' && observations !== undefined && observations !== null) {
		console.log(`[${num}] Skipping row ${row.rowNumber} because observations are present`, `Elapsed time: ${intoSeconds(Date.now() - start_time)}`);
		continue;
	}
	/* if (isNaN(parseInt(num))) {
		console.log(`[${num}] Skipping row ${row.rowNumber} because number is not a number`, `Elapsed time: ${intoSeconds(Date.now() - start_time)}`);
		continue;
	} */

	console.log(`[${num}] Processing row (${concept}, ${arg}, ${observations})`, `Elapsed time: ${intoSeconds(Date.now() - start_time)}`);
	// Draw conclusion
	const conclusion = await drawConclusion(
		"Write a twenty word opinion on how well the first concept matches the argument, written in spanish:",
		concept, arg, ENV.GEMINI_API_KEY
	);
	row.set(HEADERS.OBSERVATIONS, conclusion);
	await row.save();
	console.log(`[${num}] Saved conclusion (${conclusion})`, `Elapsed time: ${intoSeconds(Date.now() - start_time)}`);
	// Sleep to avoid rate limiting
	await sleep(RATE_LIMIT);
}
console.log('Finished processing rows', `Elapsed time: ${intoSeconds(Date.now() - start_time)}`, readableDate(Date.now()));