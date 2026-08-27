import type { FastifyReply } from "fastify";

export interface ApiEnvelope<T> {
  success: true;
  data: T;
}

export interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function ok<T>(reply: FastifyReply, data: T, status = 200): FastifyReply {
  return reply.code(status).send({ success: true, data } satisfies ApiEnvelope<T>);
}

export function fail(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): FastifyReply {
  return reply.code(status).send({
    success: false,
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  } satisfies ApiErrorEnvelope);
}
