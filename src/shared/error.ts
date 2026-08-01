type ErrorConstructor<T> = abstract new (...args: never[]) => T;

export type NodeErrorWithCode<C extends string = string> = Error & {
    code: C;
};

export function isErrorType<T>(
    value: unknown,
    errorType: ErrorConstructor<T>
): value is T {
    return value instanceof errorType;
}

export function isErrorStatus<T extends { status: number }>(
    error: unknown,
    errorType: ErrorConstructor<T>,
    status?: number | number[]
): error is T {
    if (!isErrorType(error, errorType)) {
        return false;
    }

    if (status === undefined) {
        return true;
    }

    return Array.isArray(status)
        ? status.includes(error.status)
        : error.status === status;
}

export function isNodeErrorCode<const T extends string>(
    error: unknown,
    code: T
): error is NodeErrorWithCode<T> {
    if (
        !isErrorType(error, Error) ||
        !('code' in error) ||
        typeof error.code !== 'string'
    ) {
        return false;
    }

    return error.code === code;
}

export function isTimeoutError(error: unknown): error is Error {
    return (
        isErrorType(error, Error) &&
        ['AbortError', 'TimeoutError'].includes(error.name)
    );
}

export function toError<T extends Error>(
    error: unknown,
    errorType?: ErrorConstructor<T>
): T | Error {
    if (
        (errorType && isErrorType(error, errorType)) ||
        isErrorType(error, Error)
    ) {
        return error;
    }

    return new Error(String(error));
}
