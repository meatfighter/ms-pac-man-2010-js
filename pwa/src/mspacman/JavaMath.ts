export const INT_MAX = 2147483647;

export function toInt(value: number): number {
    return Math.trunc(value);
}

export function intDiv(value: number, divisor: number): number {
    return Math.trunc(value / divisor);
}

export function toFloat(value: number): number {
    return Math.fround(value);
}

export function make2D(rows: number, columns: number, value = 0): number[][] {
    return Array.from({ length: rows }, () => Array.from({ length: columns }, () => value));
}

export function make3D(depth: number, rows: number, columns: number, value = 0): number[][][] {
    return Array.from({ length: depth }, () => make2D(rows, columns, value));
}

export function charCode(text: string, index: number): number {
    return text.charCodeAt(index);
}

export function replaceChar(text: string, index: number, value: string): string {
    return `${text.substring(0, index)}${value}${text.substring(index + 1)}`;
}
