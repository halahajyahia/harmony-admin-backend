const { createRemoteJWKSet, jwtVerify } = require("jose");
console.log("🔥 THIS IS THE RIGHT SERVER FILE 🔥");
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { adminsContainer, eventsContainer, eventParticipantsContainer } = require("./db/cosmos");
const { deleteBlobByStorageKey } = require("./services/blobStorage");
const verifyAdminToken = require("./middleware/verifyAdminToken");
const app = express();
const adminEventsRoutes = require("./routes/adminEvents");

app.use(
  cors({
origin: process.env.FRONTEND_URL || "http://localhost:5174",
    credentials: true,
  })
);

app.use(express.json());
app.use("/api/admin/events", verifyAdminToken, adminEventsRoutes);
async function deleteExistingParticipantsForEvent(eventId) {
  const querySpec = {
    query: "SELECT c.id FROM c WHERE c.eventId = @eventId",
    parameters: [{ name: "@eventId", value: eventId }],
  };

  const { resources } = await eventParticipantsContainer.items
    .query(querySpec)
    .fetchAll();

  for (const item of resources) {
    await eventParticipantsContainer.item(item.id, eventId).delete();
  }
}
/* =========================
   Health check
========================= */
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

/* =========================
   Microsoft admin auth
========================= */
app.post("/api/admin/auth/microsoft", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        ok: false,
        message: "Missing access token",
      });
    }

    const accessToken = authHeader.split(" ")[1];

    const tenantId = process.env.MICROSOFT_TENANT_ID;
    const apiClientId = process.env.MICROSOFT_API_CLIENT_ID;

    if (!tenantId || !apiClientId) {
      return res.status(500).json({
        ok: false,
        message: "Microsoft environment variables are missing",
      });
    }

    const jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)
    );

    let payload;

try {
  ({ payload } = await jwtVerify(accessToken, jwks, {
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    audience: `api://${apiClientId}`,
  }));
} catch (err) {
  ({ payload } = await jwtVerify(accessToken, jwks, {
    issuer: `https://sts.windows.net/${tenantId}/`,
    audience: `api://${apiClientId}`,
  }));
}

console.log("ACCESS TOKEN PAYLOAD:", payload);
    const scopes = (payload.scp || "").split(" ");
    if (!scopes.includes("access_as_user")) {
      return res.status(403).json({
        ok: false,
        message: "Required scope is missing",
      });
    }

    const email =
      payload.preferred_username ||
      payload.email ||
      payload.upn ||
      null;

    const name = payload.name || "";
    const providerUserId = payload.oid || payload.sub || "";

    if (!email) {
      return res.status(400).json({
        ok: false,
        message: "No email claim found in token",
      });
    }

    const querySpec = {
      query: "SELECT * FROM c WHERE c.email = @email",
      parameters: [{ name: "@email", value: email }],
    };

    const { resources } = await adminsContainer.items
      .query(querySpec)
      .fetchAll();

    let admin = resources[0];

    if (!admin) {
      const newAdmin = {
        id: `admin_${Date.now()}`,
        type: "admin",
        email,
        name,
        provider: "microsoft",
        providerUserId,
        createdAt: new Date().toISOString(),
      };

      const { resource } = await adminsContainer.items.create(newAdmin);
      admin = resource;
    }

    return res.json({
      ok: true,
      admin,
    });
  }  catch (error) {
  console.error("Microsoft access token verification error:");
  console.error(error);
  console.error("message:", error.message);
  console.error("code:", error.code);
  return res.status(401).json({
    ok: false,
    message: "Invalid Microsoft access token",
  });
}
});

/* =========================
   Get admin profile
========================= */
app.get("/api/admin/me", verifyAdminToken, async (req, res) => {
  try {
    const email = req.adminAuth.email;

    const querySpec = {
      query: "SELECT * FROM c WHERE c.email = @email",
      parameters: [{ name: "@email", value: email }],
    };

    const { resources } = await adminsContainer.items
      .query(querySpec)
      .fetchAll();

    const admin = resources[0];

    if (!admin) {
      return res.status(404).json({
        ok: false,
        message: "admin not found",
      });
    }

    return res.json({
      ok: true,
      admin,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    return res.status(500).json({
      ok: false,
      message: "Internal server error",
    });
  }
});

/* =========================
   Update admin profile
========================= */
app.put("/api/admin/profile", verifyAdminToken, async (req, res) => {
  try {
    const email = req.adminAuth.email;
    const { name, organizationName, phone, bio } = req.body;

    const querySpec = {
      query: "SELECT * FROM c WHERE c.email = @email",
      parameters: [{ name: "@email", value: email }],
    };

    const { resources } = await adminsContainer.items
      .query(querySpec)
      .fetchAll();

    const admin = resources[0];

    if (!admin) {
      return res.status(404).json({
        ok: false,
        message: "admin not found",
      });
    }

    admin.name = name ?? admin.name;
    admin.organizationName = organizationName ?? "";
    admin.phone = phone ?? "";
    admin.bio = bio ?? "";

    const { resource } = await adminsContainer
      .item(admin.id, admin.email)
      .replace(admin);

    return res.json({
      ok: true,
      admin: resource,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    return res.status(500).json({
      ok: false,
      message: "Internal server error",
    });
  }
});

/* ========================*/
app.delete("/api/admin/profile", verifyAdminToken, async (req, res) => {
  try {
    const email = req.adminAuth.email;
    const adminId = req.adminAuth.providerUserId;

    const adminQuerySpec = {
      query: "SELECT * FROM c WHERE c.email = @email",
      parameters: [{ name: "@email", value: email }],
    };

    const { resources: admins } = await adminsContainer.items
      .query(adminQuerySpec)
      .fetchAll();

    const admin = admins[0];

    if (!admin) {
      return res.status(404).json({
        ok: false,
        message: "admin not found",
      });
    }

    const eventsQuerySpec = {
      query: "SELECT * FROM c WHERE c.createdByAdminId = @adminId",
      parameters: [{ name: "@adminId", value: adminId }],
    };

    const { resources: events } = await eventsContainer.items
      .query(eventsQuerySpec)
      .fetchAll();

    for (const event of events) {
      if (event.participantsFile?.storageKey) {
        await deleteBlobByStorageKey(event.participantsFile.storageKey);
      }

      await deleteExistingParticipantsForEvent(event.id);
      await eventsContainer.item(event.id, event.id).delete();
    }

    await adminsContainer.item(admin.id, admin.email).delete();

    return res.json({
      ok: true,
      message: "admin and all related data deleted successfully",
      deletedEventsCount: events.length,
    });
  } catch (error) {
    console.error("Delete profile error:", error);
    return res.status(500).json({
      ok: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});
/* =========================
   Start server
========================= */
app.listen(process.env.PORT || 4000, () => {
  console.log(`Server running on http://localhost:${process.env.PORT || 4000}`);
});