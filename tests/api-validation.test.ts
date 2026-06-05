import { expect, test, describe, beforeAll } from "bun:test";

const BASE_URL = "http://localhost:3000/api";
const API_KEY = process.env.API_KEY || "s4fFyhvWimUJNYyArbHdVjLn";

describe("API Validation Tests", () => {
  let jwtToken: string;

  test("1. Health Check (Public)", async () => {
    const response = await fetch(`${BASE_URL}/health`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe("ok");
  });

  test("2. Security - Reject request without API Key", async () => {
    const response = await fetch(`${BASE_URL}/tickets`);
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("API Key requerida");
  });

  test("3. Security - Reject request with invalid API Key", async () => {
    const response = await fetch(`${BASE_URL}/tickets`, {
      headers: { "x-api-key": "invalid-key" },
    });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("API Key inválida");
  });

  test("4. Auth - Generate JWT Token", async () => {
    const response = await fetch(`${BASE_URL}/auth/token`, {
      method: "POST",
      headers: { "x-api-key": API_KEY },
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.token).toBeDefined();
    jwtToken = data.token;
  });

  test("5. Tickets - List Categories", async () => {
    const response = await fetch(`${BASE_URL}/tickets/categories`, {
      headers: {
        "x-api-key": API_KEY,
        "Authorization": `Bearer ${jwtToken}`,
      },
    });
    expect(response.status).toBe(200);
    const categories = await response.json();
    expect(Array.isArray(categories)).toBe(true);
    expect(categories.length).toBeGreaterThan(0);
  });

  test("6. Tickets - Create New Ticket", async () => {
    const payload = {
      idUser: 1,
      idCategory: 1,
      title: "Test Ticket from automation",
      description: "This is a test ticket created by the validation suite.",
      priority: "Medium",
      codigo: "A-LY39EKKZTK",
    };

    const response = await fetch(`${BASE_URL}/tickets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "Authorization": `Bearer ${jwtToken}`,
      },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);
    const ticket = await response.json();
    expect(ticket.id).toBeDefined();
    expect(ticket.title).toBe(payload.title);
  });

  test("7. Tickets - List and Verify", async () => {
    const response = await fetch(`${BASE_URL}/tickets`, {
      headers: {
        "x-api-key": API_KEY,
        "Authorization": `Bearer ${jwtToken}`,
      },
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.total).toBeGreaterThan(0);
    expect(Array.isArray(data.tickets)).toBe(true);
    
    const found = data.tickets.find((t: any) => t.title === "Test Ticket from automation");
    expect(found).toBeDefined();
  });

  test("8. Tickets - Get Code Info (404 Non-existent)", async () => {
    const response = await fetch(`${BASE_URL}/tickets/code/non-existent-code`, {
      headers: {
        "x-api-key": API_KEY,
        "Authorization": `Bearer ${jwtToken}`,
      },
    });
    expect(response.status).toBe(404);
  });

  test("9. User Info - Get User Info (404 Non-existent)", async () => {
    const response = await fetch(`${BASE_URL}/tickets/user/9999999`, {
      headers: {
        "x-api-key": API_KEY,
        "Authorization": `Bearer ${jwtToken}`,
      },
    });
    expect(response.status).toBe(404);
  });

  test("10. User Info - Get User Info (400 Invalid ID)", async () => {
    const response = await fetch(`${BASE_URL}/tickets/user/invalid-id`, {
      headers: {
        "x-api-key": API_KEY,
        "Authorization": `Bearer ${jwtToken}`,
      },
    });
    expect(response.status).toBe(400);
  });

  test("11. Security - Get Code Info rejects request without API Key", async () => {
    const response = await fetch(`${BASE_URL}/tickets/code/non-existent-code`, {
      headers: {
        "Authorization": `Bearer ${jwtToken}`,
      },
    });
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("API Key requerida");
  });

  test("12. Security - Get Code Info rejects request with invalid API Key", async () => {
    const response = await fetch(`${BASE_URL}/tickets/code/non-existent-code`, {
      headers: {
        "x-api-key": "invalid-key",
        "Authorization": `Bearer ${jwtToken}`,
      },
    });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("API Key inválida");
  });

  test("13. Security - Get Code Info rejects request without JWT Token", async () => {
    const response = await fetch(`${BASE_URL}/tickets/code/non-existent-code`, {
      headers: {
        "x-api-key": API_KEY,
      },
    });
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Token de acceso requerido");
  });

  test("14. Security - Get Code Info rejects request with invalid JWT Token", async () => {
    const response = await fetch(`${BASE_URL}/tickets/code/non-existent-code`, {
      headers: {
        "x-api-key": API_KEY,
        "Authorization": "Bearer invalid-token",
      },
    });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Token inválido o expirado");
  });

  test("15. Security - Get User Info rejects request without API Key", async () => {
    const response = await fetch(`${BASE_URL}/tickets/user/1`, {
      headers: {
        "Authorization": `Bearer ${jwtToken}`,
      },
    });
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("API Key requerida");
  });

  test("16. Security - Get User Info rejects request with invalid API Key", async () => {
    const response = await fetch(`${BASE_URL}/tickets/user/1`, {
      headers: {
        "x-api-key": "invalid-key",
        "Authorization": `Bearer ${jwtToken}`,
      },
    });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("API Key inválida");
  });

  test("17. Security - Get User Info rejects request without JWT Token", async () => {
    const response = await fetch(`${BASE_URL}/tickets/user/1`, {
      headers: {
        "x-api-key": API_KEY,
      },
    });
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Token de acceso requerido");
  });

  test("18. Security - Get User Info rejects request with invalid JWT Token", async () => {
    const response = await fetch(`${BASE_URL}/tickets/user/1`, {
      headers: {
        "x-api-key": API_KEY,
        "Authorization": "Bearer invalid-token",
      },
    });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Token inválido o expirado");
  });
});

