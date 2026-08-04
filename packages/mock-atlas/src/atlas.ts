/**
 * The Atlas GraphQL surface: auth handshake, roles, and the user/email lifecycle
 * (see @kleros/kleros-app for the operations and response shapes).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

import type { AddUserData, ConfirmEmailData, ConfirmEmailResponse, UpdateEmailData, User } from "@kleros/kleros-app";
import { recoverMessageAddress, type Hex } from "viem";

import { bearerAddress, createJwt } from "./auth";
import { log, readBody, sendJson } from "./http";
import { MOCK_ROLES } from "./index";

const users = new Map<string, User>();

type GraphqlBody = {
  operationName?: string;
  query?: string;
  variables?: Record<string, unknown>;
};

const operationOf = (body: GraphqlBody): string | null =>
  body.operationName ?? /(?:query|mutation)\s+([A-Za-z0-9_]+)/.exec(body.query ?? "")?.[1] ?? null;

export const handleGraphql = async (req: IncomingMessage, res: ServerResponse) => {
  const body = JSON.parse((await readBody(req)).toString()) as GraphqlBody;
  const operation = operationOf(body);
  const variables = body.variables ?? {};

  switch (operation) {
    case "GetNonce": {
      log(`GetNonce for ${String(variables.address)}`);
      return sendJson(res, 200, { data: { nonce: `0x${randomBytes(16).toString("hex")}` } });
    }

    case "Login": {
      const address = await recoverMessageAddress({
        message: variables.message as string,
        signature: variables.signature as Hex,
      });
      log(`Login ${address}`);
      return sendJson(res, 200, { data: { login: { accessToken: await createJwt(address) } } });
    }

    case "Roles":
      return sendJson(res, 200, { data: { roles: MOCK_ROLES } });

    case "GetUser": {
      const address = bearerAddress(req);
      return sendJson(res, 200, { data: { user: (address && users.get(address)) || null } });
    }

    case "AddUser": {
      const address = bearerAddress(req);
      if (!address) return sendJson(res, 200, { errors: [{ message: "Unauthorized" }] });

      const settings = (variables.settings ?? {}) as Partial<AddUserData>;
      users.set(address, { email: settings.email ?? "", isEmailVerified: false, emailUpdateableAt: null });

      log(`AddUser ${address} (${settings.email ?? "no email"})`);
      return sendJson(res, 200, { data: { addUser: true } });
    }

    case "UpdateEmail": {
      const address = bearerAddress(req);
      const user = address && users.get(address);
      if (!user) return sendJson(res, 200, { errors: [{ message: "User not found" }] });

      const { newEmail } = variables as Partial<UpdateEmailData>;
      users.set(address, { email: newEmail ?? "", isEmailVerified: false, emailUpdateableAt: null });

      log(`UpdateEmail ${address} -> ${newEmail ?? "<missing>"}`);
      return sendJson(res, 200, { data: { updateEmail: true } });
    }

    case "ConfirmEmail": {
      const { address } = variables as Partial<ConfirmEmailData>;
      const user = address && users.get(address.toLowerCase());
      if (!user) {
        const rejected: ConfirmEmailResponse = { isConfirmed: false, isTokenExpired: false, isTokenInvalid: true };
        return sendJson(res, 200, { data: { confirmEmail: rejected } });
      }

      users.set(address.toLowerCase(), { ...user, isEmailVerified: true });

      log(`ConfirmEmail ${address}`);
      const confirmed: ConfirmEmailResponse = { isConfirmed: true, isTokenExpired: false, isTokenInvalid: false };
      return sendJson(res, 200, { data: { confirmEmail: confirmed } });
    }

    case "DeleteUser": {
      const address = bearerAddress(req);
      if (address) users.delete(address);

      log(`DeleteUser ${address ?? "unknown"}`);

      return sendJson(res, 200, { data: { deleteUser: true } });
    }

    default: {
      console.error(`[mock-atlas] UNHANDLED graphql operation: ${operation ?? "<anonymous>"}`);
      return sendJson(res, 200, { errors: [{ message: `mock-atlas: unhandled operation ${operation}` }] });
    }
  }
};
