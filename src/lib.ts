import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from "google-spreadsheet";


export async function getSheetByName(doc: GoogleSpreadsheet, sheetName: string) {
	const sheet = doc.sheetsByTitle[sheetName];
	if (!sheet) {
		throw new Error(`Sheet ${sheetName} not found`);
	}
	return sheet;
}

export async function getColumnByHeaderName(sheet: GoogleSpreadsheetWorksheet, headerName: string) {
	await sheet.loadHeaderRow(0);
	return sheet.headerValues.findIndex((value) => value === headerName);
}

function deconstructPathed(path: string, obj: any) {
	const parts = path.split(".");
	let current = obj;
	for (const part of parts) {
		if (!current[part]) {
			return null;
		}
		current = current[part];
	}
	return current;
}

export async function drawConclusion(preprompt:string, premise1: string, premise2: string, apiKey: string) {
	if (!premise1 || !premise2) return "";

	// Prepare the prompt for Gemini
	const prompt = `${preprompt}
	Concept: ${premise1}  
	Argument:  ${premise2}
	`;

	const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=" + apiKey;
	const req = new Request(url, {
		"method": "post",
		"body": JSON.stringify({
			"contents": [
				{
					"parts": [
						{
							"text": prompt
						}
					]
				}
			]
		}),
		"headers": {
			"Content-Type": "application/json"
		}
	});
	//console.log(req.body)


	const response = await fetch(req).catch((error) => {
		console.error("Error:", error);
		return null;
	})
	if (!response) {
		console.error("No response");
		return "";
	}
	const data = await response.json().catch((error) => {
		console.error("Error:", error);
	})
	if (!data) {
		console.error("No data");
		return "";
	}

	//console.log(data)

	// Extract the conclusion from the response, guarded
	//const conclusion = data.candidates[0]?.content?.parts[0]?.text;

	const conclusion = deconstructPathed("candidates.0.content.parts.0.text", data);
	if (!conclusion) {
		console.log("No conclusion found", data);
		return "";
	}
	//console.log(conclusion)
	return conclusion;
}

export function readableTime(time: number) {
	const seconds = Math.floor(time / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	const timeString = `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
	return timeString;
}

export function intoSeconds(time: number) {
	const seconds = Math.floor(time / 1000);
	return seconds;
}