import { HttpErrorResponse } from '@angular/common/http';
import { isNotFound, toProblem } from './problem';

describe('toProblem', () => {
  it('passes Problem Details from the server through', () => {
    const problem = {
      type: 'about:blank',
      title: 'Invalid filter',
      status: 400,
      detail: 'zone must be AMBIENT or CHILLED',
      errors: [{ field: 'zone', message: 'Must be AMBIENT or CHILLED.' }],
    };
    expect(toProblem(new HttpErrorResponse({ status: 400, error: problem }))).toEqual(problem);
  });

  it('describes a network failure', () => {
    expect(toProblem(new HttpErrorResponse({ status: 0 })).title).toBe("Can't reach the server");
  });

  it('describes a non-Problem error response', () => {
    const problem = toProblem(
      new HttpErrorResponse({ status: 502, statusText: 'Bad Gateway', error: '<html>' }),
    );
    expect(problem).toMatchObject({ title: 'Bad Gateway', status: 502 });
  });

  it('describes any other error', () => {
    expect(toProblem(new Error('boom'))).toMatchObject({
      title: 'Something went wrong',
      detail: 'boom',
    });
  });

  it('recognizes a 404', () => {
    expect(isNotFound(new HttpErrorResponse({ status: 404 }))).toBe(true);
    expect(isNotFound(new HttpErrorResponse({ status: 500 }))).toBe(false);
  });
});
