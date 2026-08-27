import { describe, expect, it } from "vitest";
import {
  joinRemote,
  normalizeRemotePosixPath,
  isRemotePathDescendantOfRoot,
  posixRelativePath,
} from "../src/paths";
import * as path from "path";

describe("normalizeRemotePosixPath", () => {
  it("normaliza barras e remove trailing slash", () => {
    expect(normalizeRemotePosixPath("/var/www/")).toBe("/var/www");
    expect(normalizeRemotePosixPath("var/www")).toBe("var/www");
  });

  it("mantém raiz POSIX", () => {
    expect(normalizeRemotePosixPath("/")).toBe("/");
  });
});

describe("isRemotePathDescendantOfRoot", () => {
  it("aceita filho direto da raiz", () => {
    expect(
      isRemotePathDescendantOfRoot("/var/www", "/var/www/public/index.php")
    ).toBe(true);
  });

  it("rejeita caminho fora da raiz", () => {
    expect(isRemotePathDescendantOfRoot("/var/www", "/etc/passwd")).toBe(false);
  });
});

describe("joinRemote", () => {
  it("junta raiz com segmento relativo", () => {
    expect(joinRemote("/var/www", "app/index.php")).toBe("/var/www/app/index.php");
  });

  it("trata raiz POSIX / sem duplicar barras", () => {
    expect(joinRemote("/", "index.php")).toBe("/index.php");
    expect(joinRemote("", "index.php")).toBe("/index.php");
  });
});

describe("posixRelativePath", () => {
  it("calcula relativo dentro da raiz local", () => {
    const root = path.join("C:", "projeto");
    const file = path.join(root, "src", "index.ts");
    expect(posixRelativePath(file, root)).toBe("src/index.ts");
  });

  it("retorna undefined fora da raiz", () => {
    const root = path.join("C:", "projeto");
    const file = path.join("C:", "outro", "ficheiro.ts");
    expect(posixRelativePath(file, root)).toBeUndefined();
  });
});
