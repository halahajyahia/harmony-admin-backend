const express = require("express");
const router = express.Router();
const verifyAdminToken = require("../middleware/verifyAdminToken");

async function parseServiceResponse(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { error: text || "Invalid response from matching service" };
  }
}
console.log("Registering rebuild-all route");
router.post("/admin/rebuild-all/:eventId", verifyAdminToken, async (req, res) => {
    console.log("HIT rebuild-all route");
    
  try {
    const { eventId } = req.params;
        console.log(
        "Calling URL:",
        `${process.env.MATCHING_SERVICE_URL}/api/match/admin/rebuild-all/${eventId}`
        );
    const response = await fetch(
      `${process.env.MATCHING_SERVICE_URL}/api/match/admin/rebuild-all/${eventId}`,
      {
        method: "POST",
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );
    console.log("Matching response status:", response.status);
    const data = await parseServiceResponse(response);

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.json(data);
  } catch (error) {
    console.error("Proxy rebuild-all error:", error);
    return res.status(500).json({ error: "Failed to connect to matching service" });
  }
});

router.post("/admin/add/:eventId/:id", verifyAdminToken, async (req, res) => {
  try {
    const { eventId, id } = req.params;

    const response = await fetch(
      `${process.env.MATCHING_SERVICE_URL}/api/match/admin/add/${eventId}/${id}`,
      {
        method: "POST",
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );

    const data = await parseServiceResponse(response);

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.json(data);
  } catch (error) {
    console.error("Proxy add error:", error);
    return res.status(500).json({ error: "Failed to connect to matching service" });
  }
});

router.post("/admin/update/:eventId/:id", verifyAdminToken, async (req, res) => {
  try {
    const { eventId, id } = req.params;

    const response = await fetch(
      `${process.env.MATCHING_SERVICE_URL}/api/match/admin/update/${eventId}/${id}`,
      {
        method: "POST",
        headers: {
          Authorization: req.headers.authorization,
        },
      }
    );

    const data = await parseServiceResponse(response);

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.json(data);
  } catch (error) {
    console.error("Proxy update error:", error);
    return res.status(500).json({ error: "Failed to connect to matching service" });
  }
});
router.get("/ping", (req, res) => {
  res.json({ ok: true, message: "match routes connected" });
});
router.post("/admin/test", (req, res) => {
  console.log("MATCH POST TEST HIT");
  res.json({ ok: true });
});
module.exports = router;
