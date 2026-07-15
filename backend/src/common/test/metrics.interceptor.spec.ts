import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { MetricsInterceptor } from '../interceptors/metrics.interceptor';

const mockCounter = { inc: jest.fn() };
const mockHistogram = { observe: jest.fn() };
const mockResponseSizeHistogram = { observe: jest.fn() };

function mockHttpContext(overrides: {
  method?: string;
  routePath?: string;
  path?: string;
  statusCode?: number;
  contentLength?: string;
}): ExecutionContext {
  const request = {
    method: overrides.method ?? 'GET',
    route: overrides.routePath ? { path: overrides.routePath } : undefined,
    path: overrides.path ?? '/movies/1',
  };
  const response = {
    statusCode: overrides.statusCode ?? 200,
    getHeader: jest.fn(() => overrides.contentLength),
  };
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

function handlerThrowing(err: Error): CallHandler {
  return { handle: () => throwError(() => err) };
}

describe('MetricsInterceptor', () => {
  let interceptor: MetricsInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new MetricsInterceptor(
      mockCounter as never,
      mockHistogram as never,
      mockResponseSizeHistogram as never,
    );
  });

  it('records the matched route pattern, method, and status on success', async () => {
    const context = mockHttpContext({
      method: 'GET',
      routePath: '/movies/:id',
      statusCode: 200,
      contentLength: '1234',
    });

    await lastValueFrom(interceptor.intercept(context, handlerReturning({})));

    expect(mockCounter.inc).toHaveBeenCalledWith({
      method: 'GET',
      route: '/movies/:id',
      status_code: '200',
    });
    expect(mockHistogram.observe).toHaveBeenCalledWith(
      { method: 'GET', route: '/movies/:id', status_code: '200' },
      expect.any(Number),
    );
    expect(mockResponseSizeHistogram.observe).toHaveBeenCalledWith(
      { method: 'GET', route: '/movies/:id', status_code: '200' },
      1234,
    );
  });

  it('records a response size of 0 when content-length is absent', async () => {
    const context = mockHttpContext({
      method: 'GET',
      routePath: '/movies/:id',
      statusCode: 200,
    });

    await lastValueFrom(interceptor.intercept(context, handlerReturning({})));

    expect(mockResponseSizeHistogram.observe).toHaveBeenCalledWith(
      { method: 'GET', route: '/movies/:id', status_code: '200' },
      0,
    );
  });

  it('falls back to the raw path when no route pattern matched (e.g. 404)', async () => {
    const context = mockHttpContext({
      method: 'GET',
      routePath: undefined,
      path: '/does-not-exist',
      statusCode: 404,
    });

    await lastValueFrom(interceptor.intercept(context, handlerReturning({})));

    expect(mockCounter.inc).toHaveBeenCalledWith({
      method: 'GET',
      route: '/does-not-exist',
      status_code: '404',
    });
  });

  it('still records metrics when the handler throws', async () => {
    const context = mockHttpContext({
      method: 'POST',
      routePath: '/reservations',
      statusCode: 500,
    });

    await expect(
      lastValueFrom(
        interceptor.intercept(context, handlerThrowing(new Error('boom'))),
      ),
    ).rejects.toThrow('boom');

    expect(mockCounter.inc).toHaveBeenCalledWith({
      method: 'POST',
      route: '/reservations',
      status_code: '500',
    });
  });

  it('skips non-HTTP contexts (e.g. WebSocket) without touching the metrics', () => {
    const context = { getType: () => 'ws' } as unknown as ExecutionContext;

    interceptor.intercept(context, handlerReturning({}));

    expect(mockCounter.inc).not.toHaveBeenCalled();
    expect(mockHistogram.observe).not.toHaveBeenCalled();
  });
});
