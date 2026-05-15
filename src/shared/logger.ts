import { format } from 'util';
import { ansi, SubsystemColors, Subsystems } from './ansi.js';

function prefix(subsystem: Subsystems): string {
    return `${SubsystemColors[subsystem]}[${subsystem}]${ansi.reset}`;
}

function message(color: string | string[], args: unknown[]): string {
    const colorPrefix = Array.isArray(color) ? color.join('') : color;

    return `${colorPrefix}${format(...args)}${ansi.reset}`;
}

export function debug(subsystem: Subsystems, ...args: unknown[]): void {
    if (process.env.DEBUG !== '1') {
        return;
    }

    console.debug(
        `${prefix(subsystem)} ${message([ansi.gray, ansi.dim], args)}`
    );
}

export function info(subsystem: Subsystems, ...args: unknown[]): void {
    console.info(`${prefix(subsystem)} ${message(ansi.blue, args)}`);
}

export function log(subsystem: Subsystems, ...args: unknown[]): void {
    console.log(`${prefix(subsystem)} ${message([], args)}`);
}

export function warn(subsystem: Subsystems, ...args: unknown[]): void {
    console.warn(`${prefix(subsystem)} ${message(ansi.yellow, args)}`);
}

export function error(subsystem: Subsystems, ...args: unknown[]): void {
    console.error(`${prefix(subsystem)} ${message(ansi.red, args)}`);
}

const logger = {
    debug,
    info,
    log,
    warn,
    error,
};
export default logger;
