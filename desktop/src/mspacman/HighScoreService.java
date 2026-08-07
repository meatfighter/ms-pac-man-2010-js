package mspacman;

import com.google.gson.*;
import java.io.*;
import java.math.*;
import java.net.*;
import java.nio.charset.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;

public class HighScoreService {

  private static final int PROTOCOL_VERSION = 1;
  private static final int WORLD_COUNT = 4;
  private static final int ROWS_PER_WORLD = 5;
  private static final int MAX_SCORE = Integer.MAX_VALUE;
  private static final int MAX_RESPONSE_BYTES = 8192;
  private static final int TIMEOUT_MS = 5000;
  private static final String DEFAULT_URL =
      "https://meatfighter.com/api/ms-pac-man-2010/scores";

  public boolean downloadScores(HighScore[][] highScores) {
    ArrayList<RemoteHighScore> scores = requestScores("GET", null);
    if (scores == null) {
      return false;
    }
    applyScores(highScores, scores);
    return true;
  }

  public boolean submitScore(
      HighScore[][] highScores, int world, int score, String initials) {

    if (!isWorld(world) || !isPlausibleScore(score)
        || !isAllowedInitials(initials)) {
      return false;
    }

    byte[] key = getHmacKey();
    if (key == null) {
      return false;
    }

    String checksum = calculateChecksum(key, world, score, initials);
    String body = "{\"protocolVersion\":" + PROTOCOL_VERSION
        + ",\"world\":" + world
        + ",\"score\":" + score
        + ",\"initials\":\"" + initials + "\""
        + ",\"checksum\":\"" + checksum + "\"}";
    ArrayList<RemoteHighScore> scores = requestScores("POST", body);
    if (scores == null) {
      return false;
    }
    applyScores(highScores, scores);
    return true;
  }

  private ArrayList<RemoteHighScore> requestScores(String method, String body) {
    HttpURLConnection connection = null;
    try {
      URL url = new URL(getApiUrl());
      connection = (HttpURLConnection) url.openConnection();
      connection.setRequestMethod(method);
      connection.setUseCaches(false);
      connection.setConnectTimeout(TIMEOUT_MS);
      connection.setReadTimeout(TIMEOUT_MS);
      connection.setRequestProperty(
          "MsPacMan-Protocol-Version", String.valueOf(PROTOCOL_VERSION));
      if ("POST".equals(method)) {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        connection.setDoOutput(true);
        connection.setFixedLengthStreamingMode(bytes.length);
        connection.setRequestProperty("Content-Type", "application/json");
        OutputStream out = connection.getOutputStream();
        try {
          out.write(bytes);
        } finally {
          out.close();
        }
      }

      if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
        return null;
      }
      String responseVersion =
          connection.getHeaderField("MsPacMan-Protocol-Version");
      if (!String.valueOf(PROTOCOL_VERSION).equals(responseVersion)) {
        return null;
      }
      if (!isJsonContentType(connection.getContentType())) {
        return null;
      }
      String text = readBounded(connection.getInputStream());
      return parseScoresResponse(text);
    } catch(Throwable t) {
      return null;
    } finally {
      if (connection != null) {
        connection.disconnect();
      }
    }
  }

  private String readBounded(InputStream input) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[1024];
    int total = 0;
    try {
      while(true) {
        int read = input.read(buffer);
        if (read < 0) {
          break;
        }
        total += read;
        if (total > MAX_RESPONSE_BYTES) {
          throw new IOException("High-score response was too large.");
        }
        out.write(buffer, 0, read);
      }
    } finally {
      input.close();
    }
    return new String(out.toByteArray(), StandardCharsets.UTF_8);
  }

  private ArrayList<RemoteHighScore> parseScoresResponse(String text) {
    JsonElement root = JsonParser.parseString(text);
    if (!root.isJsonObject()) {
      return null;
    }
    JsonObject object = root.getAsJsonObject();
    if (!hasExactKeys(object, "protocolVersion", "scores")) {
      return null;
    }
    Integer protocolVersion = readInt(object.get("protocolVersion"));
    if (protocolVersion == null || protocolVersion.intValue() != PROTOCOL_VERSION) {
      return null;
    }
    JsonElement scoresElement = object.get("scores");
    if (scoresElement == null || !scoresElement.isJsonArray()) {
      return null;
    }
    return validateScoreTable(scoresElement.getAsJsonArray());
  }

  private ArrayList<RemoteHighScore> validateScoreTable(JsonArray array) {
    if (array.size() > WORLD_COUNT * ROWS_PER_WORLD) {
      return null;
    }

    int[] counts = new int[WORLD_COUNT];
    HashSet<String> tuples = new HashSet<String>();
    ArrayList<RemoteHighScore> scores = new ArrayList<RemoteHighScore>();
    int previousWorld = -1;
    int previousScore = MAX_SCORE;

    for(JsonElement element : array) {
      RemoteHighScore score = readScore(element);
      if (score == null) {
        return null;
      }
      if (++counts[score.world] > ROWS_PER_WORLD) {
        return null;
      }
      if (score.world < previousWorld) {
        return null;
      }
      if (score.world != previousWorld) {
        previousWorld = score.world;
        previousScore = MAX_SCORE;
      }
      if (score.score > previousScore) {
        return null;
      }
      previousScore = score.score;

      String tuple = score.world + "|" + score.score + "|" + score.initials;
      if (tuples.contains(tuple)) {
        return null;
      }
      tuples.add(tuple);
      scores.add(score);
    }
    return scores;
  }

  private RemoteHighScore readScore(JsonElement element) {
    if (element == null || !element.isJsonObject()) {
      return null;
    }
    JsonObject object = element.getAsJsonObject();
    if (!hasExactKeys(object, "world", "score", "initials")) {
      return null;
    }
    Integer world = readInt(object.get("world"));
    Integer score = readInt(object.get("score"));
    String initials = readString(object.get("initials"));
    if (world == null || score == null || initials == null
        || !isWorld(world.intValue()) || !isPlausibleScore(score.intValue())
        || !isAllowedInitials(initials)) {
      return null;
    }
    return new RemoteHighScore(world.intValue(), score.intValue(), initials);
  }

  private Integer readInt(JsonElement element) {
    if (element == null || !element.isJsonPrimitive()) {
      return null;
    }
    JsonPrimitive primitive = element.getAsJsonPrimitive();
    if (!primitive.isNumber()) {
      return null;
    }
    try {
      BigDecimal value = primitive.getAsBigDecimal();
      return Integer.valueOf(value.intValueExact());
    } catch(Throwable t) {
      return null;
    }
  }

  private String readString(JsonElement element) {
    if (element == null || !element.isJsonPrimitive()) {
      return null;
    }
    JsonPrimitive primitive = element.getAsJsonPrimitive();
    if (!primitive.isString()) {
      return null;
    }
    return primitive.getAsString();
  }

  private boolean hasExactKeys(JsonObject object, String a, String b) {
    return object.entrySet().size() == 2
        && object.has(a)
        && object.has(b);
  }

  private boolean hasExactKeys(JsonObject object, String a, String b, String c) {
    return object.entrySet().size() == 3
        && object.has(a)
        && object.has(b)
        && object.has(c);
  }

  private void applyScores(
      HighScore[][] highScores, ArrayList<RemoteHighScore> remoteScores) {

    for(int world = 0; world < WORLD_COUNT; world++) {
      for(int row = 0; row < ROWS_PER_WORLD; row++) {
        highScores[world][row] = new HighScore();
      }
    }

    int[] indexes = new int[WORLD_COUNT];
    for(RemoteHighScore remoteScore : remoteScores) {
      int row = indexes[remoteScore.world]++;
      HighScore highScore = new HighScore();
      highScore.score = remoteScore.score;
      highScore.initials = remoteScore.initials;
      highScores[remoteScore.world][row] = highScore;
    }
  }

  private boolean isWorld(int value) {
    return value >= 0 && value < WORLD_COUNT;
  }

  private boolean isPlausibleScore(int value) {
    return value > 0 && value <= MAX_SCORE && value % 10 == 0;
  }

  private boolean isAllowedInitials(String value) {
    if (value == null || value.length() != 3) {
      return false;
    }
    for(int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      if (c != ' ' && (c < 'A' || c > 'Z')) {
        return false;
      }
    }
    return true;
  }

  private String getApiUrl() {
    String value = System.getProperty("mspacman.scoreApiUrl");
    if (value == null || value.length() == 0) {
      value = System.getenv("MSPACMAN_SCORE_API_URL");
    }
    if (value == null || value.length() == 0) {
      value = DEFAULT_URL;
    }
    return value;
  }

  private boolean isJsonContentType(String value) {
    if (value == null) {
      return false;
    }
    int semicolon = value.indexOf(';');
    String mediaType = semicolon < 0 ? value : value.substring(0, semicolon);
    return "application/json".equals(mediaType.trim().toLowerCase(Locale.ROOT));
  }

  private byte[] getHmacKey() {
    String value = System.getProperty("mspacman.hmacKeyHex");
    if (value == null || value.length() == 0) {
      value = System.getenv("MSPACMAN_HMAC_KEY_HEX");
    }
    if (value == null || value.length() != 64) {
      return null;
    }
    return hexToBytes(value);
  }

  private String calculateChecksum(
      byte[] key, int world, int score, String initials) {

    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(key, "HmacSHA256"));
      String message = "mspacman-score|" + PROTOCOL_VERSION + "|"
          + world + "|" + score + "|" + initials;
      return bytesToHex(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
    } catch(Throwable t) {
      return "";
    }
  }

  private byte[] hexToBytes(String hex) {
    byte[] bytes = new byte[hex.length() / 2];
    for(int i = 0; i < bytes.length; i++) {
      int high = hexValue(hex.charAt(i * 2));
      int low = hexValue(hex.charAt(i * 2 + 1));
      if (high < 0 || low < 0) {
        return null;
      }
      bytes[i] = (byte) ((high << 4) | low);
    }
    return bytes;
  }

  private int hexValue(char c) {
    if (c >= '0' && c <= '9') {
      return c - '0';
    }
    if (c >= 'a' && c <= 'f') {
      return 10 + c - 'a';
    }
    return -1;
  }

  private String bytesToHex(byte[] bytes) {
    char[] hex = new char[bytes.length * 2];
    char[] digits = "0123456789abcdef".toCharArray();
    for(int i = 0; i < bytes.length; i++) {
      int value = bytes[i] & 0xff;
      hex[i * 2] = digits[value >>> 4];
      hex[i * 2 + 1] = digits[value & 0x0f];
    }
    return new String(hex);
  }

  private static class RemoteHighScore {
    public final int world;
    public final int score;
    public final String initials;

    public RemoteHighScore(int world, int score, String initials) {
      this.world = world;
      this.score = score;
      this.initials = initials;
    }
  }
}
