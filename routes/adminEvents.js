const express = require("express");
const crypto = require("crypto");
const verifyAdminToken = require("../middleware/verifyAdminToken");
const { eventsContainer, eventParticipantsContainer } = require("../db/cosmos");const multer = require("multer");
const path = require("path");
const {
  uploadBufferToBlob,
  sanitizeFileName,
  downloadBlobToBuffer,
  deleteBlobByStorageKey,
} = require("../services/blobStorage");
const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});
const XLSX = require("xlsx");
const { stat } = require("fs");
function isAllowedParticipantsFile(file) {
  if (!file) return false;

  const allowedMimeTypes = [
    "text/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ];

  const allowedExtensions = [".csv", ".xls", ".xlsx"];
  const ext = path.extname(file.originalname).toLowerCase();

  return allowedMimeTypes.includes(file.mimetype) && allowedExtensions.includes(ext);
}
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
function normalizeCellValue(value) {
  if (value == null) return "";
  return String(value).trim();
}
function getValueByPossibleKeys(row, possibleKeys) {
  for (const key of possibleKeys) {
    if (row[key] != null && String(row[key]).trim() !== "") {
      return normalizeCellValue(row[key]);
    }
  }
  return "";
}
function mapParticipantRow(row) {
  return {
    name: getValueByPossibleKeys(row, [
      "Name",
      "Full Name",
      "name",
      "fullName",
      "الاسم",
      "الاسم الكامل",
      "الاسم الرباعي",
      "الاسم الثلاثي",
      "שם",
      "שם מלא",
      "שם פרטי ושם משפחה",
    ]),
    phoneNumber: getValueByPossibleKeys(row, [
      "Phone number",
      "Phone Number",
      "Phone",
      "phone",
      "phoneNumber",
      "Mobile",
    ]),
    jobTitle: getValueByPossibleKeys(row, [
      "Job Title",
      "jobTitle",
      "Title",
      "Role",
      "Position",
      "المسمى الوظيفي",
      "الوظيفة",
      "العمل الحالي",
      "תפקיד",
      "תפקיד נוכחי",
      "תפקיד בעבודה",
      "تعريف مهني",
    ]),
    academicResume: getValueByPossibleKeys(row, [
      "Academic Resume",
      "academicResume",
      "Academic Background",
      "Academic Bio",
      "السيرة الأكاديمية",
    ]),
    professionalResume: getValueByPossibleKeys(row, [
      "Professional Resume",
      "professionalResume",
      "Professional Background",
      "Professional Bio",
      "السيرة المهنية",
    ]),
    personalResume: getValueByPossibleKeys(row, [
      "Personal Resume",
      "personalResume",
      "Personal Bio",
      "About Me",
      "السيرة الشخصية",
    ]),
    iWantToMeet: getValueByPossibleKeys(row, [
      "I want to meet",
      "I Want to Meet",
      "iWantToMeet",
      "Want to Meet",
      "Looking For",
      "I want to connect with",
      "أريد أن ألتقي",
      "אני רוצה לפגוש",
      "أريد أن أتواصل مع",
      "تود التعارف مع",

    ]),
    photoUrl: getValueByPossibleKeys(row, [
      "Photo URL",
      "photoUrl",
      "Photo",
      "Image URL",
      "Profile Photo",
      "رابط الصورة",
      "תמונת פרופיל",
      "thumbnail_url",
      "photo_url",
    ]),
  };
}
router.post("/", verifyAdminToken, async (req, res) => {
  try {
        const {
          name,
          date,
          location = "",
          description = "",
          supportedLanguages = [],
        } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Event name is required" });
    }

    if (!date || !date.trim()) {
      return res.status(400).json({ error: "Event date is required" });
    }

    const now = new Date().toISOString();

    const newEvent = {
  id: crypto.randomUUID(),
  name: name.trim(),
  date: date.trim(),
  location: location.trim(),
  description: description.trim(),
  status: "draft",
  supportedLanguages,
  participantsFile: null,
  participantsImport: {
    status: "not_started",
    totalRows: 0,
    processedRows: 0,
    failedRows: 0,
    startedAt: null,
    finishedAt: null,
  },
  matchingStatus: "pending",
  createdByAdminId: req.adminAuth.providerUserId,
  createdAt: now,
  updatedAt: now,
};

    const { resource } = await eventsContainer.items.create(newEvent);

    return res.status(201).json(resource);
  } catch (error) {
    console.error("Create event error:", error);
    return res.status(500).json({ error: "Failed to create event" });
  }
});
router.get("/", verifyAdminToken, async (req, res) => {
  try {
    const adminId = req.adminAuth.providerUserId;

    const querySpec = {
      query: "SELECT * FROM c WHERE c.createdByAdminId = @adminId ORDER BY c.createdAt DESC",
      parameters: [
        { name: "@adminId", value: adminId }
      ],
    };

    const { resources } = await eventsContainer.items
      .query(querySpec)
      .fetchAll();

    return res.status(200).json(resources);
  } catch (error) {
    console.error("Get events error:", error);
    return res.status(500).json({ error: "Failed to fetch events" });
  }
});
router.get("/:id", verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.adminAuth.providerUserId;

    const { resource } = await eventsContainer.item(id, id).read();

    if (!resource) {
      return res.status(404).json({ error: "Event not found" });
    }

    if (resource.createdByAdminId !== adminId) {
      return res.status(403).json({ error: "Access denied" });
    }

    return res.status(200).json(resource);
  } catch (error) {
    console.error("Get event by id error:", error);
    return res.status(500).json({ error: "Failed to fetch event" });
  }
});
router.put("/:id", verifyAdminToken, async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.adminAuth.providerUserId;

    const {
      name,
      date,
      location = "",
      description = "",
      status = "draft",
      supportedLanguages = [],
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Event name is required" });
    }

    if (!date || !date.trim()) {
      return res.status(400).json({ error: "Event date is required" });
    }

    const { resource: existingEvent } = await eventsContainer.item(id, id).read();

    if (!existingEvent) {
      return res.status(404).json({ error: "Event not found" });
    }

    if (existingEvent.createdByAdminId !== adminId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const updatedEvent = {
      ...existingEvent,
      name: name.trim(),
      date: date.trim(),
      location: location.trim(),
      description: description.trim(),
      status,
      supportedLanguages,
      updatedAt: new Date().toISOString(),
      matchingStatus: req.body.matchingStatus || existingEvent.matchingStatus,
    };

    const { resource } = await eventsContainer.items.upsert(updatedEvent);

    return res.status(200).json(resource);
  } catch (error) {
    console.error("Update event error:", error);
    return res.status(500).json({ error: "Failed to update event" });
  }
});
router.delete("/:id", verifyAdminToken, async (req, res) => {
  try {
    const eventId = req.params.id;
    const adminId = req.adminAuth.providerUserId;

    const { resource: existingEvent } =
      await eventsContainer.item(eventId, eventId).read();

    if (!existingEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (existingEvent.createdByAdminId !== adminId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    console.log("Deleting event:", {
      eventId,
      participantsFile: existingEvent.participantsFile || null,
    });

    if (existingEvent.participantsFile?.storageKey) {
      const blobDeleteResult = await deleteBlobByStorageKey(
        existingEvent.participantsFile.storageKey
      );

      console.log("Blob delete result:", blobDeleteResult);
    } else {
      console.log("No participants file storageKey found on event");
    }

    await deleteExistingParticipantsForEvent(eventId);
    await eventsContainer.item(eventId, eventId).delete();

    return res.json({
      message: "Event and all related data deleted successfully",
    });
  } catch (error) {
    console.error("Delete event error:", error);
    return res.status(500).json({
      message: "Failed to delete event",
      error: error.message,
    });
  }
});
router.post("/:id/participants-file", verifyAdminToken, upload.single("file"), async (req, res) => {
  try {
    const eventId = req.params.id;
    const adminId = req.adminAuth.providerUserId;

    const { resource: existingEvent } = await eventsContainer.item(eventId, eventId).read();

    if (!existingEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (existingEvent.createdByAdminId !== adminId) {
      return res.status(403).json({
        message: "You are not allowed to upload a file for this event",
      });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    if (!isAllowedParticipantsFile(req.file)) {
      return res.status(400).json({
        message: "Only CSV, XLS, and XLSX files are allowed",
      });
    }

    const now = new Date().toISOString();
    const safeOriginalName = sanitizeFileName(req.file.originalname);
    const uniqueFileName = `${Date.now()}-${safeOriginalName}`;
    const storageKey = `events/${eventId}/participants/${uniqueFileName}`;

    await uploadBufferToBlob({
      buffer: req.file.buffer,
      storageKey,
      mimeType: req.file.mimetype,
    });

    const updatedEvent = {
  ...existingEvent,
  participantsFile: {
    fileName: uniqueFileName,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    storageKey,
    uploadedAt: now,
    uploadedByAdminId: adminId,
    uploadStatus: "uploaded",

  },
  participantsImport: {
    status: "not_started",
    totalRows: 0,
    processedRows: 0,
    failedRows: 0,
    startedAt: null,
    finishedAt: null,
  },
  updatedAt: now,
};

    const { resource: savedEvent } = await eventsContainer
      .item(eventId, eventId)
      .replace(updatedEvent);

    return res.status(200).json({
      message: "Participants file uploaded successfully",
      event: savedEvent,
    });
  } catch (error) {
    console.error("Upload participants file error:", error);
    return res.status(500).json({
      message: "Failed to upload participants file",
      error: error.message,
    });
  }
});
router.post("/:id/process-participants", verifyAdminToken, async (req, res) => {
  try {
    const eventId = req.params.id;
    const adminId = req.adminAuth.providerUserId;
    const savedPreviewParticipants = [];

    const { resource: existingEvent } =
      await eventsContainer.item(eventId, eventId).read();

    if (!existingEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (existingEvent.createdByAdminId !== adminId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (!existingEvent.participantsFile?.storageKey) {
      return res.status(400).json({ message: "No participants file uploaded" });
    }

    const startedAt = new Date().toISOString();

    const processingEvent = {
      ...existingEvent,
      participantsImport: {
        status: "processing",
        totalRows: 0,
        processedRows: 0,
        failedRows: 0,
        startedAt,
        finishedAt: null,
      },
      updatedAt: startedAt,
    };

    await eventsContainer.item(eventId, eventId).replace(processingEvent);

    const fileBuffer = await downloadBlobToBuffer(
      existingEvent.participantsFile.storageKey
    );

    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    await deleteExistingParticipantsForEvent(eventId);

    let processedRows = 0;
    let failedRows = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const mappedRow = mapParticipantRow(row);

      try {
        const now = new Date().toISOString();

        const participantDoc = {
          id: crypto.randomUUID(),
          eventId,
          rowNumber: i + 1,
          name: mappedRow.name,
          phoneNumber: mappedRow.phoneNumber,
          jobTitle: mappedRow.jobTitle,
          academicResume: mappedRow.academicResume,
          professionalResume: mappedRow.professionalResume,
          personalResume: mappedRow.personalResume,
          iWantToMeet: mappedRow.iWantToMeet,
          photoUrl: mappedRow.photoUrl,
          status: "pending",
          isOnline: false,
          rawData: row,
          createdAt: now,
          updatedAt: now,
        };

        await eventParticipantsContainer.items.create(participantDoc);
        savedPreviewParticipants.push(participantDoc);
        processedRows++;
      } catch (rowError) {
        console.error(`Failed to save row ${i + 1}:`, rowError);
        failedRows++;
      }
    }

    const finishedAt = new Date().toISOString();

    const completedEvent = {
      ...processingEvent,
      participantsImport: {
        status: "completed",
        totalRows: rows.length,
        processedRows,
        failedRows,
        startedAt,
        finishedAt,
      },
      updatedAt: finishedAt,
    };

    await eventsContainer.item(eventId, eventId).replace(completedEvent);

    return res.json({
      message: "Participants file processed successfully",
      event: completedEvent,
      previewParticipants: savedPreviewParticipants.slice(0, 8),
    });
  } catch (error) {
    console.error("Process participants error:", error);

    try {
      const eventId = req.params.id;
      const { resource: existingEvent } =
        await eventsContainer.item(eventId, eventId).read();

      if (existingEvent) {
        const failedAt = new Date().toISOString();

        await eventsContainer.item(eventId, eventId).replace({
          ...existingEvent,
          participantsImport: {
            ...(existingEvent.participantsImport || {}),
            status: "failed",
            finishedAt: failedAt,
          },
          updatedAt: failedAt,
        });
      }
    } catch (innerError) {
      console.error("Failed to update import status to failed:", innerError);
    }

    return res.status(500).json({
      message: "Processing failed",
      error: error.message,
    });
  }
});
router.get("/:id/participants", verifyAdminToken, async (req, res) => {
  try {
    const eventId = req.params.id;
    const adminId = req.adminAuth.providerUserId;

    const { resource: existingEvent } =
      await eventsContainer.item(eventId, eventId).read();

    if (!existingEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (existingEvent.createdByAdminId !== adminId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const querySpec = {
      query: "SELECT * FROM c WHERE c.eventId = @eventId ORDER BY c.rowNumber ASC",
      parameters: [{ name: "@eventId", value: eventId }],
    };

    const { resources: participants } = await eventParticipantsContainer.items
      .query(querySpec)
      .fetchAll();

    return res.json({
      eventId,
      count: participants.length,
      participants,
    });
  } catch (error) {
    console.error("Get participants error:", error);
    return res.status(500).json({ message: "Failed to fetch participants" });
  }
});
router.delete("/:id/participants-file", verifyAdminToken, async (req, res) => {
  try {
    const eventId = req.params.id;
    const adminId = req.adminAuth.providerUserId;

    const { resource: existingEvent } =
      await eventsContainer.item(eventId, eventId).read();

    if (!existingEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (existingEvent.createdByAdminId !== adminId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (!existingEvent.participantsFile?.storageKey) {
      return res.status(400).json({ message: "No participants file to delete" });
    }

    await deleteBlobByStorageKey(existingEvent.participantsFile.storageKey);
    await deleteExistingParticipantsForEvent(eventId);

    const updatedEvent = {
      ...existingEvent,
      participantsFile: null,
      participantsImport: {
        status: "not_started",
        totalRows: 0,
        processedRows: 0,
        failedRows: 0,
        startedAt: null,
        finishedAt: null,
      },
      updatedAt: new Date().toISOString(),
      matchingStatus: "pending",
    };

    await eventsContainer.item(eventId, eventId).replace(updatedEvent);

    return res.json({
      message: "Participants file deleted successfully",
      event: updatedEvent,
    });
  } catch (error) {
    console.error("Delete participants file error:", error);
    return res.status(500).json({ message: "Failed to delete participants file" });
  }
});
router.put("/:id/participants/:participantId", verifyAdminToken, async (req, res) => {
  try {
    const eventId = req.params.id;
    const participantId = req.params.participantId;
    const adminId = req.adminAuth.providerUserId;

    const { resource: existingEvent } =
      await eventsContainer.item(eventId, eventId).read();

    if (!existingEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (existingEvent.createdByAdminId !== adminId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { resource: existingParticipant } =
      await eventParticipantsContainer.item(participantId, eventId).read();

    if (!existingParticipant) {
      return res.status(404).json({ message: "Participant not found" });
    }

    const updatedAt = new Date().toISOString();
    const name = req.body.name?.trim?.() || "";
    const phoneNumber = req.body.phoneNumber?.trim?.() || "";
    const jobTitle = req.body.jobTitle?.trim?.() || "";
    const professionalResume = req.body.professionalResume?.trim?.() || "";
    const personalResume = req.body.personalResume?.trim?.() || "";
    const iWantToMeet = req.body.iWantToMeet?.trim?.() || "";
    const academicResume = req.body.academicResume?.trim?.() || "";

    if (!name || !phoneNumber || !jobTitle || !professionalResume || !personalResume || !iWantToMeet || !academicResume) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }
    const updatedParticipant = {
  ...existingParticipant,
  name,
  phoneNumber,
  jobTitle,
  academicResume,
professionalResume,
  personalResume,
  iWantToMeet,
  photoUrl: req.body.photoUrl?.trim?.() || "",
  updatedAt,
  status: req.body.status || existingParticipant.status,
  isOnline: typeof req.body.isOnline === "boolean" ? req.body.isOnline : existingParticipant.isOnline,
};

    const { resource: savedParticipant } =
      await eventParticipantsContainer.item(participantId, eventId).replace(updatedParticipant);

    return res.json({
      message: "Participant updated successfully",
      participant: savedParticipant,
    });
  } catch (error) {
    console.error("Update participant error:", error);
    return res.status(500).json({ message: "Failed to update participant" });
  }
});
router.delete("/:id/participants/:participantId", verifyAdminToken, async (req, res) => {
  try {
    const eventId = req.params.id;
    const participantId = req.params.participantId;
    const adminId = req.adminAuth.providerUserId;

    const { resource: existingEvent } =
      await eventsContainer.item(eventId, eventId).read();

    if (!existingEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (existingEvent.createdByAdminId !== adminId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { resource: existingParticipant } =
      await eventParticipantsContainer.item(participantId, eventId).read();

    if (!existingParticipant) {
      return res.status(404).json({ message: "Participant not found" });
    }

    await eventParticipantsContainer.item(participantId, eventId).delete();

    return res.json({
      message: "Participant deleted successfully",
      participantId,
    });
  } catch (error) {
    console.error("Delete participant error:", error);
    return res.status(500).json({ message: "Failed to delete participant" });
  }
});
router.post("/:id/participants", verifyAdminToken, async (req, res) => {
  try {
    const eventId = req.params.id;
    const adminId = req.adminAuth.providerUserId;

    const { resource: existingEvent } =
      await eventsContainer.item(eventId, eventId).read();

    if (!existingEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (existingEvent.createdByAdminId !== adminId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const now = new Date().toISOString();
    const name = req.body.name?.trim?.() || "";
    const phoneNumber = req.body.phoneNumber?.trim?.() || "";
    const jobTitle = req.body.jobTitle?.trim?.() || "";
    const professionalResume = req.body.professionalResume?.trim?.() || "";
    const personalResume = req.body.personalResume?.trim?.() || "";
    const iWantToMeet = req.body.iWantToMeet?.trim?.() || "";
    const academicResume = req.body.academicResume?.trim?.() || "";

    if (!name || !phoneNumber || !jobTitle || !professionalResume || !personalResume || !iWantToMeet || !academicResume) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }
    const newParticipant = {
  id: crypto.randomUUID(),
  eventId,
  rowNumber: Date.now(),
  name,
  phoneNumber,
  jobTitle,
  academicResume,
  professionalResume,
  personalResume,
  iWantToMeet,
  photoUrl: req.body.photoUrl?.trim?.() || "",
  rawData: null,
  createdAt: now,
  updatedAt: now,
  source: "manual",
  status: "pending",
  isOnline: false,
};

    const { resource: savedParticipant } =
      await eventParticipantsContainer.items.create(newParticipant);

    return res.status(201).json({
      message: "Participant created successfully",
      participant: savedParticipant,
    });
  } catch (error) {
    console.error("Create participant error:", error);
    return res.status(500).json({ message: "Failed to create participant" });
  }
});
router.get("/:id/participants-file/download", verifyAdminToken, async (req, res) => {
  try {
    const eventId = req.params.id;
    const adminId = req.adminAuth.providerUserId;

    const { resource: existingEvent } =
      await eventsContainer.item(eventId, eventId).read();

    if (!existingEvent) {
      return res.status(404).json({ message: "Event not found" });
    }

    if (existingEvent.createdByAdminId !== adminId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (!existingEvent.participantsFile?.storageKey) {
      return res.status(404).json({ message: "No participants file found" });
    }

    const fileBuffer = await downloadBlobToBuffer(
      existingEvent.participantsFile.storageKey
    );

    const fileName =
      existingEvent.participantsFile.originalName ||
      existingEvent.participantsFile.fileName ||
      "participants-file";

    const mimeType =
      existingEvent.participantsFile.mimeType ||
      "application/octet-stream";

    res.setHeader("Content-Type", mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(fileName)}"`
    );

    return res.send(fileBuffer);
  } catch (error) {
    console.error("Download participants file error:", error);
    return res.status(500).json({
      message: "Failed to download participants file",
      error: error.message,
    });
  }
});
const { buildEventAnalytics } = require("../utils/buildEventAnalytics");

router.get("/:eventId/analytics", verifyAdminToken, async (req, res) => {
  try {
    const { eventId } = req.params;

    const querySpec = {
      query: "SELECT * FROM c WHERE c.eventId = @eventId",
      parameters: [{ name: "@eventId", value: eventId }],
    };

    const { resources: participants } = await eventParticipantsContainer.items
      .query(querySpec)
      .fetchAll();

    const analytics = buildEventAnalytics(participants || []);

    res.json({
      eventId,
      analytics,
    });
  } catch (error) {
    console.error("Get event analytics failed:", error);
    res.status(500).json({
      message: "Failed to load event analytics",
    });
  }
});
module.exports = router;