export function nullableString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

export function nullableNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
