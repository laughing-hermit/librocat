// The database functions Better Auth's Convex adapter calls into this
// component (create, find, update, delete over the tables in schema.ts).
import { createApi } from "@convex-dev/better-auth";
import { createAuthOptions } from "../auth";
import schema from "./schema";

export const { create, findOne, findMany, updateOne, updateMany, deleteOne, deleteMany } =
  createApi(schema, createAuthOptions);
