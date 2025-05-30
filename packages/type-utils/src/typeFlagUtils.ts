import * as tsutils from 'ts-api-utils';
import * as ts from 'typescript';

const ANY_OR_UNKNOWN = ts.TypeFlags.Any | ts.TypeFlags.Unknown;

/**
 * Gets all of the type flags in a type, iterating through unions automatically.
 */
export function getTypeFlags(type: ts.Type): ts.TypeFlags {
  // @ts-expect-error Since typescript 5.0, this is invalid, but uses 0 as the default value of TypeFlags.
  let flags: ts.TypeFlags = 0;
  for (const t of tsutils.unionConstituents(type)) {
    flags |= t.flags;
  }
  return flags;
}

/**
 * @param flagsToCheck The composition of one or more `ts.TypeFlags`.
 * @param isReceiver Whether the type is a receiving type (e.g. the type of a
 * called function's parameter).
 * @remarks
 * Note that if the type is a union, this function will decompose it into the
 * parts and get the flags of every union constituent. If this is not desired,
 * use the `isTypeFlag` function from tsutils.
 */
export function isTypeFlagSet(
  type: ts.Type,
  flagsToCheck: ts.TypeFlags,
  /** @deprecated This params is not used and will be removed in the future.*/
  isReceiver?: boolean,
): boolean {
  const flags = getTypeFlags(type);

  // eslint-disable-next-line @typescript-eslint/no-deprecated -- not used
  if (isReceiver && flags & ANY_OR_UNKNOWN) {
    return true;
  }

  return (flags & flagsToCheck) !== 0;
}
