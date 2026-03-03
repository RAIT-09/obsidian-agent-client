function splitCommandSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;

	for (let i = 0; i < command.length; i++) {
		const char = command[i];
		const next = command[i + 1];

		if (char === "\\" && i + 1 < command.length) {
			current += char + command[i + 1];
			i++;
			continue;
		}

		if (quote) {
			current += char;
			if (char === quote) {
				quote = null;
			}
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			current += char;
			continue;
		}

		const isDoubleDelimiter =
			(char === "&" && next === "&") || (char === "|" && next === "|");
		const isSingleDelimiter = char === ";" || char === "|" || char === "&";
		if (isDoubleDelimiter || isSingleDelimiter) {
			const trimmed = current.trim();
			if (trimmed.length > 0) {
				segments.push(trimmed);
			}
			current = "";
			if (isDoubleDelimiter) {
				i++;
			}
			continue;
		}

		current += char;
	}

	const tail = current.trim();
	if (tail.length > 0) {
		segments.push(tail);
	}

	return segments;
}

function tokenize(segment: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;

	for (let i = 0; i < segment.length; i++) {
		const char = segment[i];
		if (char === "\\" && i + 1 < segment.length) {
			current += segment[i + 1];
			i++;
			continue;
		}

		if (quote) {
			if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}

		if (/\s/.test(char)) {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
			continue;
		}

		current += char;
	}

	if (current.length > 0) {
		tokens.push(current);
	}

	return tokens;
}

function isEnvAssignment(token: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function normalizeCommandToken(token: string): string {
	const normalized = token.trim().replace(/^['"]|['"]$/g, "");
	const parts = normalized.split(/[\\/]/).filter((part) => part.length > 0);
	return (parts[parts.length - 1] || normalized).toLowerCase();
}

function extractBaseCommandFromSegment(segment: string): string | null {
	const tokens = tokenize(segment);
	if (tokens.length === 0) {
		return null;
	}

	let index = 0;
	while (index < tokens.length) {
		const token = tokens[index];
		if (isEnvAssignment(token)) {
			index++;
			continue;
		}

		if (token === "sudo") {
			index++;
			while (index < tokens.length && tokens[index].startsWith("-")) {
				index++;
			}
			continue;
		}

		if (token === "env") {
			index++;
			while (
				index < tokens.length &&
				(tokens[index].startsWith("-") || isEnvAssignment(tokens[index]))
			) {
				index++;
			}
			continue;
		}

		if (token === "command" || token === "nohup" || token === "time") {
			index++;
			while (index < tokens.length && tokens[index].startsWith("-")) {
				index++;
			}
			continue;
		}

		return normalizeCommandToken(token);
	}

	return null;
}

export function extractBaseCommands(command: string): string[] {
	const commands: string[] = [];
	for (const segment of splitCommandSegments(command)) {
		const base = extractBaseCommandFromSegment(segment);
		if (base) {
			commands.push(base);
		}
	}
	return commands;
}

export function isDestructiveCommand(
	command: string,
	denylist: string[],
): boolean {
	const denied = new Set(
		denylist
			.map((item) => item.trim().toLowerCase())
			.filter((item) => item.length > 0),
	);
	if (denied.size === 0) {
		return false;
	}

	return extractBaseCommands(command).some((base) => denied.has(base));
}

