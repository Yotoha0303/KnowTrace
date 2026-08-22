export type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        requestId: string;
        fieldErrors?: Record<string, string[]>;
      };
    };
