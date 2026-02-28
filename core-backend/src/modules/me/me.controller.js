// ==============================
// GET /api/users/me
// ==============================

exports.getMe = async (req, res, next) => {

  try {

    // ✅ Defense-in-depth
    if (!req.user) {

      return res.status(401).json({

        success: false,
        message: "Unauthorized"

      });

    }

    const {
      userId,
      organizationId,
      role
    } = req.user;


    // ✅ Token claim validation (extra safety)
    if (!userId || !organizationId || !role) {

      return res.status(401).json({

        success: false,
        message: "Invalid token claims"

      });

    }


    return res.status(200).json({

      success: true,

      user: {

        userId,
        organizationId,
        role

      }

    });

  }
  catch (error) {

    console.error(
      "GET /api/users/me ERROR >>>",
      error.message
    );

    return next(error);

  }

};