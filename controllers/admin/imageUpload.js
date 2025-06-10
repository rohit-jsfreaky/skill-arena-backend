import fs from "fs";
import multer from "multer";
import path from "path";

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Create a unique filename with original extension
    const fileExt = path.extname(file.originalname);
    const fileName = `${Date.now()}-${Math.round(
      Math.random() * 1e9
    )}${fileExt}`;
    cb(null, fileName);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Invalid file type. Only JPEG, PNG, GIF and WEBP images are allowed."
      ),
      false
    );
  }
};
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
}).single("image");

export const uploadImage = (req, res) => {
  console.log("req rec");
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          message: "File too large. Maximum size is 5MB.",
        });
      }
     
      return res.status(400).json({
        success: false,
        message: `Upload error: ${err.message}`,
      });
    } else if (err) {
      // An unknown error occurred
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image file provided",
      });
    }

    const SERVER_URL = `${req.protocol}://${req.get("host")}`;
    const fileUrl = `${SERVER_URL}/uploads/${req.file.filename}`;

    return res.status(200).json({
      success: true,
      message: "Image uploaded successfully",
      url: fileUrl,
      filename: req.file.filename,
      size: req.file.size,
    });
  });
};
