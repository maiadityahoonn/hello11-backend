import axios from "axios";

/**
 * Sends an OTP via MSG91 WhatsApp Bulk API.
 * @param {string} mobile - The mobile number (including country code without +).
 * @param {string} otp - The 6-digit OTP to send.
 */
export const sendWhatsAppOTP = async (mobile, otp) => {
  const authKey = process.env.MSG91_AUTHKEY;
  const integratedNumber = process.env.MSG91_INTEGRATED_NUMBER;
  const namespace = process.env.MSG91_NAMESPACE;

  if (!authKey || !integratedNumber) {
    console.error("MSG91 credentials missing in .env");
    return { success: false, message: "Server configuration error" };
  }

  // Ensure mobile is in correct format (91XXXXXXXXXX)
  let formattedMobile = mobile.replace(/\D/g, "");
  if (formattedMobile.length === 10) {
    formattedMobile = "91" + formattedMobile;
  }

  const data = {
    integrated_number: integratedNumber,
    content_type: "template",
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: "otp_universal",
        language: {
          code: "en",
          policy: "deterministic",
        },
        namespace: namespace,
        to_and_components: [
          {
            to: [formattedMobile],
            components: {
              body_1: {
                type: "text",
                value: otp,
              },
              button_1: {
                subtype: "url",
                type: "text",
                value: "verify", // Placeholder for button variable
              },
            },
          },
        ],
      },
    },
  };

  const config = {
    method: "post",
    url: "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/",
    headers: {
      authkey: authKey,
      "Content-Type": "application/json",
    },
    data: data,
  };

  try {
    const response = await axios(config);
    console.log("MSG91 WhatsApp Response:", response.data);
    return { success: true, data: response.data };
  } catch (error) {
    console.error("MSG91 WhatsApp Error:", error.response ? error.response.data : error.message);
    return { success: false, error: error.response ? error.response.data : error.message };
  }
};
