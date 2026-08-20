/**
 * The fixed set of methods a remote caller can invoke on a board, routed to the
 * controller. This is the seam between transport and board: the desktop app fed
 * it from IPC, the web app feeds it from the command stream, and the tests feed
 * it directly.
 *
 * Failures are returned rather than thrown so the transport can serve the
 * `status` a validator attached (422s and friends) instead of a blanket 500.
 */

/**
 * @param {object} deps
 * @param {import('./controller.mjs').Controller} deps.controller
 * @param {(patch: object) => object} deps.applyConfigure configure + mirror into the UI
 * @returns {(method: string, params?: object) => {ok: true, value: any} | {ok: false, error: {message: string, status: number}}}
 */
export function createDispatch({ controller, applyConfigure }) {
  function dispatch(method, params) {
    switch (method) {
      case 'enqueue':
        return controller.enqueue(params.text, params.options);
      case 'preview':
        return controller.preview(params.text, params.options);
      case 'status':
        return controller.status();
      case 'capabilities':
        return controller.capabilities();
      case 'flush':
        return controller.flush(params.region);
      case 'clear':
        return controller.clear(params.region);
      case 'configure':
        return applyConfigure(params);
      default: {
        const error = new Error(`unknown method: ${method}`);
        error.status = 400;
        throw error;
      }
    }
  }

  return (method, params = {}) => {
    try {
      return { ok: true, value: dispatch(method, params) };
    } catch (error) {
      return {
        ok: false,
        error: { message: String(error?.message || error), status: error?.status || 500 },
      };
    }
  };
}
