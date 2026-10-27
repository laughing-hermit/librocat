/** Which pages librocat fetches itself (the reading list, source watch): public ones only. */

import { describe, expect, test } from "vitest";
import {
  checkFetchUrl,
  isPrivateAddress,
  refusalMessage,
  siteName,
  unreachableMessage,
} from "../convex/fetchGuard";

describe("private addresses", () => {
  test("IPv4: loopback, private networks, link-local metadata, and the like", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "93.184.216.34"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  test("IPv6, including IPv4 inside it", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "[::1]"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:a00:1")).toBe(true);
    expect(isPrivateAddress("64:ff9b::7f00:1")).toBe(true);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
    expect(isPrivateAddress("not an address")).toBe(true);
  });
});

describe("URLs librocat fetches", () => {
  test("public http(s) pages pass", () => {
    expect(checkFetchUrl("https://example.com/post?a=1").hostname).toBe("example.com");
    expect(checkFetchUrl("http://93.184.216.34/").hostname).toBe("93.184.216.34");
  });

  test("other schemes, passwords, private hosts, and local names are refused", () => {
    expect(() => checkFetchUrl("file:///etc/passwd")).toThrow(/http and https/);
    expect(() => checkFetchUrl("ftp://example.com/x")).toThrow(/http and https/);
    expect(() => checkFetchUrl("https://user:pw@example.com/")).toThrow(/password/);
    expect(() => checkFetchUrl("http://127.0.0.1:3210/")).toThrow(/private address/);
    expect(() => checkFetchUrl("http://[::1]/")).toThrow(/private address/);
    expect(() => checkFetchUrl("http://169.254.169.254/latest/meta-data")).toThrow(/private/);
    expect(() => checkFetchUrl("http://localhost:3000/")).toThrow(/private/);
    expect(() => checkFetchUrl("http://db.internal/")).toThrow(/private/);
    expect(() => checkFetchUrl("not a url")).toThrow(/not a URL/);
  });

  test("a self-hoster may allow private addresses", () => {
    expect(checkFetchUrl("http://127.0.0.1:8080/wiki", true).port).toBe("8080");
    expect(checkFetchUrl("http://wiki.internal/", true).hostname).toBe("wiki.internal");
  });
});

describe("why a page couldn't be read, in a person's words", () => {
  test("a site that refuses apps says so, by the name people know it by", () => {
    expect(siteName("www.linkedin.com")).toBe("LinkedIn");
    expect(siteName("mobile.twitter.com")).toBe("X");
    expect(siteName("docs.example.com")).toBe("docs.example.com");
    for (const status of [999, 401, 403, 429, 451]) {
      expect(refusalMessage("www.linkedin.com", status)).toBe(
        "LinkedIn doesn't let apps read its pages. Save it another way: print it to a PDF " +
          "and attach that, or have your agent read it in a browser and save its text.",
      );
    }
  });
  test("a missing page and a site that's down each say what to do", () => {
    expect(refusalMessage("example.com", 404)).toBe(
      "example.com has no page at that address. Check the link.",
    );
    expect(refusalMessage("example.com", 503)).toMatch(/isn't answering right now/);
    expect(unreachableMessage("nope.example", "ENOTFOUND")).toBe(
      "nope.example can't be found. Check the link.",
    );
    expect(unreachableMessage("example.com")).toMatch(/Try again in a minute/);
  });
});
