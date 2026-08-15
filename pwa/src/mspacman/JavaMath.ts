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
    const result = new Array<number[]>(rows);
    for (let i = 0; i < rows; i++) {
        const row = new Array<number>(columns);
        for (let j = 0; j < columns; j++) {
            row[j] = value;
        }
        result[i] = row;
    }
    return result;
}

export function make3D(depth: number, rows: number, columns: number, value = 0): number[][][] {
    const result = new Array<number[][]>(depth);
    for (let i = 0; i < depth; i++) {
        result[i] = make2D(rows, columns, value);
    }
    return result;
}

export function charCode(text: string, index: number): number {
    return text.charCodeAt(index);
}

export function replaceChar(text: string, index: number, value: string): string {
    return `${text.substring(0, index)}${value}${text.substring(index + 1)}`;
}
