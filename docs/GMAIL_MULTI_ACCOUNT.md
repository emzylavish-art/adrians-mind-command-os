# Gmail, multiple accounts

Mailbox rows have a label, an address, and status `not_connected`. The status is forced on read, so an imported archive cannot mark a mailbox connected.

Sixty addresses can be stored. The storage guard is 500 rows in this browser copy. That guard is not a Gmail product limit of 50.

Connect Google returns: "Google OAuth is not configured. No mailbox was connected and no message was read or sent."

`gmail_send` uses the protected `publish` approval. After approval the worker still refuses, because no token and no Google client exist. No message body is sent anywhere.

Account isolation is structural: there are no tokens to mix. When OAuth exists later, tokens must stay server-side and owner-scoped. They must not be written into the browser snapshot.
