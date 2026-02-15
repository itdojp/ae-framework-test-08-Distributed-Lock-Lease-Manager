import fs from "node:fs";
import path from "node:path";

/**
 * Lightweight JSON Schema validator for this repository's schema subset.
 * Supports: type, required, properties, additionalProperties, enum, minimum,
 * maximum, oneOf, format(date-time), and file-local $ref.
 */
export class JsonSchemaLite {
  /**
   * @param {string} rootDir
   */
  constructor(rootDir) {
    this.rootDir = rootDir;
    /** @type {Map<string, any>} */
    this.cache = new Map();
  }

  /**
   * @param {string} relativePath
   * @returns {any}
   */
  load(relativePath) {
    const abs = path.resolve(this.rootDir, relativePath);
    if (this.cache.has(abs)) {
      return this.cache.get(abs);
    }
    const parsed = JSON.parse(fs.readFileSync(abs, "utf-8"));
    this.cache.set(abs, parsed);
    return parsed;
  }

  /**
   * @param {any} schema
   * @param {unknown} value
   * @param {string} schemaPath
   * @returns {string[]}
   */
  validate(schema, value, schemaPath = "") {
    return this.#validateInternal(schema, value, schemaPath);
  }

  /**
   * @param {any} schema
   * @param {unknown} value
   * @param {string} schemaPath
   * @returns {string[]}
   */
  #validateInternal(schema, value, schemaPath) {
    if (!schema || typeof schema !== "object") {
      return [];
    }

    if (typeof schema.$ref === "string") {
      const refSchema = this.load(path.join(path.dirname(schemaPath), schema.$ref));
      return this.#validateInternal(refSchema, value, path.join(path.dirname(schemaPath), schema.$ref));
    }

    if (Array.isArray(schema.oneOf)) {
      const branches = schema.oneOf.map((branch) => this.#validateInternal(branch, value, schemaPath));
      if (branches.some((errs) => errs.length === 0)) {
        return [];
      }
      return [`oneOf failed: ${branches.map((errs) => errs.join("; ")).join(" | ")}`];
    }

    const errors = [];

    if (typeof schema.type === "string") {
      const typeErr = this.#validateType(schema.type, value);
      if (typeErr) {
        errors.push(typeErr);
        return errors;
      }
    }

    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      errors.push(`enum mismatch: expected one of [${schema.enum.join(", ")}], got ${String(value)}`);
      return errors;
    }

    if (schema.type === "string" && schema.format === "date-time" && typeof value === "string") {
      if (Number.isNaN(Date.parse(value))) {
        errors.push(`invalid date-time: ${value}`);
      }
    }

    if (schema.type === "integer" && typeof value === "number") {
      if (!Number.isInteger(value)) {
        errors.push(`expected integer, got ${value}`);
      }
      if (typeof schema.minimum === "number" && value < schema.minimum) {
        errors.push(`minimum violation: ${value} < ${schema.minimum}`);
      }
      if (typeof schema.maximum === "number" && value > schema.maximum) {
        errors.push(`maximum violation: ${value} > ${schema.maximum}`);
      }
    }

    if (schema.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
      const obj = /** @type {Record<string, unknown>} */ (value);
      if (Array.isArray(schema.required)) {
        for (const key of schema.required) {
          if (!(key in obj)) {
            errors.push(`missing required property: ${key}`);
          }
        }
      }

      if (schema.additionalProperties === false && schema.properties && typeof schema.properties === "object") {
        const allowed = new Set(Object.keys(schema.properties));
        for (const key of Object.keys(obj)) {
          if (!allowed.has(key)) {
            errors.push(`additional property not allowed: ${key}`);
          }
        }
      }

      if (schema.properties && typeof schema.properties === "object") {
        for (const [key, childSchema] of Object.entries(schema.properties)) {
          if (key in obj) {
            const childErrors = this.#validateInternal(childSchema, obj[key], schemaPath);
            errors.push(...childErrors.map((err) => `${key}: ${err}`));
          }
        }
      }
    }

    return errors;
  }

  /**
   * @param {string} type
   * @param {unknown} value
   * @returns {string|null}
   */
  #validateType(type, value) {
    if (type === "null") {
      return value === null ? null : `expected null, got ${typeof value}`;
    }
    if (type === "integer") {
      return typeof value === "number" ? null : `expected integer, got ${typeof value}`;
    }
    if (type === "object") {
      return value && typeof value === "object" && !Array.isArray(value)
        ? null
        : `expected object, got ${Array.isArray(value) ? "array" : typeof value}`;
    }
    if (type === "string") {
      return typeof value === "string" ? null : `expected string, got ${typeof value}`;
    }
    if (type === "boolean") {
      return typeof value === "boolean" ? null : `expected boolean, got ${typeof value}`;
    }
    return null;
  }
}
