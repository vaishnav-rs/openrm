import qrcodeTerminal from "qrcode-terminal";

/** Renders a WhatsApp pairing QR payload to a terminal-printable string. */
export function renderQrToString(data: string): Promise<string> {
  return new Promise((resolve) => {
    qrcodeTerminal.generate(data, { small: true }, (output: string) => {
      resolve(output);
    });
  });
}
