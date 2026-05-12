// #7 PDF parsing abstraction. Real impl (pdfjs-dist or pdf-parse) is a follow-up; tests
// use the mock.
export interface PdfParser {
	extractText(buffer: Buffer): Promise<string>;
}

export class MockPdfParser implements PdfParser {
	private fixtures = new Map<string, string>();

	register(contentHashHex: string, text: string): void {
		this.fixtures.set(contentHashHex, text);
	}

	async extractText(buffer: Buffer): Promise<string> {
		// Default: return the buffer as UTF-8 (lets tests pass plain text bytes as a "PDF").
		// A registered fixture (keyed by hex hash) takes precedence.
		const hex = await import("node:crypto").then((m) =>
			m.createHash("sha256").update(buffer).digest("hex"),
		);
		const fix = this.fixtures.get(hex);
		if (fix !== undefined) return fix;
		return buffer.toString("utf8");
	}
}
