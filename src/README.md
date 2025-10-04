# Syrian Martyrs Gallery Bot

This is a Telegram bot for creating a gallery of Syrian martyrs. Users can add new martyrs, view their submissions, and manage their entries. The bot is built to run on Cloudflare Workers.

## Features

The bot has the following features, accessible through a main keyboard:

- **إضافة شهيد جديد (Add New Martyr)**: A step-by-step process to collect information about a new martyr, including their name, father's name, family name, date of birth, date of martyrdom, place of martyrdom, and a photo. This feature also handles editing existing entries.
- **عرض طلباتي (Show My Requests)**: Displays a list of the user's submitted requests, separated into "Pending" and "Rejected" categories. Users can choose to edit or delete their pending requests.
- **عرض اضافاتي (Show My Additions)**: Shows all the martyrs that the user has successfully added to the gallery. Users can choose to edit or request deletion of their additions.
- **مساعدة (Help)**: Displays a help message with instructions on how to use the bot.
- **إلغاء (Cancel)**: Cancels any ongoing operation (like adding a new martyr) and returns the user to the main menu.

## Database Schema

The bot uses a D1 database with the following tables:

### `sessions`

Stores temporary user session data for multi-step operations like adding a martyr.

| Column     | Type    | Description                                             |
|------------|---------|---------------------------------------------------------|
| `user_id`  | TEXT    | The user's Telegram ID. (Primary Key)                   |
| `state`    | TEXT    | The current state of the user in the state machine.     |
| `data`     | TEXT    | A JSON object containing the data collected so far.     |
| `user_info`| TEXT    | A JSON object with the user's Telegram profile info.    |
| `created_at`| TEXT    | The timestamp when the session was created.             |
| `updated_at`| TEXT    | The timestamp when the session was last updated.        |

### `block`

Manages user blocking and rate limiting.

| Column          | Type    | Description                                                     |
|-----------------|---------|-----------------------------------------------------------------|
| `telegram_id`   | TEXT    | The user's Telegram ID. (Primary Key)                           |
| `is_block`      | INTEGER | `1` if the user is blocked, `0` otherwise.                      |
| `reached_limit` | INTEGER | `1` if the user has been blocked for exceeding the limit, `0` otherwise. |
| `request_count` | INTEGER | The number of requests the user has made in the current period. |

### `submission_requests`

Stores all user submissions for adding, editing, or deleting martyrs before they are approved.

| Column             | Type    | Description                                                          |
|--------------------|---------|----------------------------------------------------------------------|
| `id`               | TEXT    | A unique ID for the request. (Primary Key)                           |
| `user_id`          | TEXT    | The Telegram ID of the user who made the request.                    |
| `full_name`        | TEXT    | The full name of the martyr.                                         |
| `name_first`       | TEXT    | The first name of the martyr.                                        |
| `name_father`      | TEXT    | The father's name of the martyr.                                     |
| `name_family`      | TEXT    | The family name of the martyr.                                       |
| `age`              | INTEGER | The martyr's age at the time of martyrdom.                           |
| `date_birth`       | TEXT    | The martyr's date of birth.                                          |
| `date_martyrdom`   | TEXT    | The date of martyrdom.                                               |
| `place`            | TEXT    | The place of martyrdom.                                              |
| `image_url`        | TEXT    | The URL of the martyr's photo (hosted on ImgBB).                     |
| `status`           | TEXT    | The status of the request (`pending`, `approved`, `rejected`).       |
| `type`             | TEXT    | The type of request (`add`, `edit`, `delete`).                       |
| `target_martyr_id` | TEXT    | For `edit` and `delete` requests, the ID of the martyr to be modified. |
| `created_at`       | TEXT    | The timestamp when the request was created.                          |
| `updated_at`       | TEXT    | The timestamp when the request was last updated.                     |

### `martyrs`

The main table containing the details of approved martyrs.

| Column          | Type    | Description                                      |
|-----------------|---------|--------------------------------------------------|
| `id`            | TEXT    | A unique ID for the martyr. (Primary Key)        |
| `telegram_id`   | TEXT    | The Telegram ID of the user who added the martyr.|
| `full_name`     | TEXT    | The full name of the martyr.                     |
| `age`           | INTEGER | The martyr's age at the time of martyrdom.       |
| `date_birth`    | TEXT    | The martyr's date of birth.                      |
| `date_martyrdom`| TEXT    | The date of martyrdom.                           |
| `place`         | TEXT    | The place of martyrdom.                          |
| `image_url`     | TEXT    | The URL of the martyr's photo.                   |
| `created_at`    | TEXT    | The timestamp when the record was created.       |

---

## How to Add a New Feature (for AI Assistants)

To add a new feature to the bot, follow these steps precisely. The project is structured to make this process simple and modular.

**Goal:** Create a new feature that is triggered by a new button on the main keyboard.

**Step 1: Create the Feature File**
- Create a new JavaScript file inside the `src/features/` directory.
- Name the file after the feature, e.g., `newFeature.js`.

**Step 2: Implement the Feature Logic**
- In your new file (`src/features/newFeature.js`), import any necessary functions from the `src/shared/` directory (e.g., `sendTelegramMessage`, `getKeyboard`).
- Create and export an `async` function that will handle the feature's logic. This function should accept `chatId`, `userId`, and `env` as arguments.
- **Example:**
  ```javascript
  // src/features/newFeature.js
  import { sendTelegramMessage } from '../shared/telegram.js';
  import { getKeyboard, createMainKeyboard, STATES } from '../shared/ui.js';

  export async function handleNewFeature(chatId, userId, env) {
      // Your feature logic here
      await sendTelegramMessage(chatId, {
          text: "This is the new feature!",
          replyMarkup: getKeyboard(createMainKeyboard(STATES.IDLE))
      }, env);
  }
  ```

**Step 3: Update the Main Router (`index.js`)**
- Open the `src/index.js` file.

**Step 4: Import the New Handler**
- At the top of `index.js`, import the handler function you just created.
- **Example:**
  ```javascript
  // src/index.js
  // ... other imports
  import { handleNewFeature } from './features/newFeature.js';
  ```

**Step 5: Add the New Command**
- Add the text for the new button to the `COMMANDS` object in `index.js`. This text must exactly match the button text you will add to the keyboard.
- **Example:**
  ```javascript
  // src/index.js
  const COMMANDS = {
      // ... other commands
      NEW_FEATURE: '✨ New Feature',
  };
  ```

**Step 6: Add the Command to the Router**
- In the `handleTextMessage` function inside `index.js`, add a new `case` to the `switch` statement for your new command.
- This `case` should call your new handler function.
- **Example:**
  ```javascript
  // src/index.js
  async function handleTextMessage(chatId, userId, text, userInfo, env) {
      // ...
      switch (text) {
          // ... other cases
          case COMMANDS.NEW_FEATURE:
              await handleNewFeature(chatId, userId, env);
              break;
          default:
          // ...
      }
  }
  ```

**Step 7: Add the Button to the UI (`ui.js`)**
- Open the `src/shared/ui.js` file.
- In the `createMainKeyboard` function, add the new button to the `layout` array.
- **Example:**
  ```javascript
  // src/shared/ui.js
  export function createMainKeyboard(state) {
      const layout = [
          ['إضافة شهيد جديد'],
          ['عرض طلباتي', 'عرض اضافاتي'],
          ['مساعدة', '✨ New Feature'] // Add the new button here
      ];
      // ...
  }
  ```

By following these steps, you will have successfully added a new, self-contained feature to the bot.
