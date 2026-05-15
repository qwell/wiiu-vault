import { type Request, type Response } from 'express';

type TitleIdQueryResult =
    | {
          ok: true;
          titleId: string;
      }
    | {
          ok: false;
          error: string;
      };

export function getStringQuery(req: Request, name: string): string | null {
    const value = req.query[name];
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function requireStringQuery(
    req: Request,
    res: Response,
    name: string,
    errorMessage = `Missing ${name} query parameter`
): string | null {
    const value = getStringQuery(req, name);
    if (value) {
        return value;
    }

    res.status(400).json({
        error: errorMessage,
    });
    return null;
}

export function getStringBodyField(body: unknown, name: string): string {
    if (typeof body !== 'object' || body === null) {
        return '';
    }

    const value = (body as Record<string, unknown>)[name];
    return typeof value === 'string' ? value : '';
}

export function getTitleIdQuery(req: Request): TitleIdQueryResult {
    const titleId = getStringQuery(req, 'titleId');

    if (!titleId) {
        return {
            ok: false,
            error: 'Missing titleId query parameter',
        };
    }

    if (!/^[0-9a-f]{16}$/i.test(titleId)) {
        return {
            ok: false,
            error: 'titleId query parameter must be 16 hexadecimal characters',
        };
    }

    return {
        ok: true,
        titleId: titleId.toLowerCase(),
    };
}

export function requireTitleIdQuery(
    req: Request,
    res: Response
): string | null {
    const result = getTitleIdQuery(req);
    if (result.ok) {
        return result.titleId;
    }

    res.status(400).json({
        error: result.error,
    });
    return null;
}
