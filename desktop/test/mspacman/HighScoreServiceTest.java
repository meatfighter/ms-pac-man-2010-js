package mspacman;

import com.google.gson.*;
import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;

public class HighScoreServiceTest {

  private static final String KEY =
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  private static final String SECOND_KEY =
      "101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f";
  private static final String EXPECTED_VECTOR =
      "fe345752fb39fd05f3311673de7990bebab48c9b801436b3a46546ce65e5c418";

  public static void main(String[] args) throws Exception {
    testHmacVector();
    testKeyPrecedence();
    testGetAndPostProtocol();
    testInvalidResponses();
    testHighScoreSemantics();
    testDelayedDownloadDoesNotOverwriteNewerLocalState();
    testFailedPostLeavesLocalLeaderboard();
    System.out.println("ok - desktop high-score protocol tests");
  }

  private static void testHmacVector() throws Exception {
    assertEquals(EXPECTED_VECTOR,
        HighScoreService.calculateChecksumForTesting(KEY, 0, 123450, "MJB"),
        "HMAC vector must match the cross-language expected value.");
    assertEquals(null,
        HighScoreService.calculateChecksumForTesting(
        repeat("A", 64), 0, 123450, "MJB"),
        "Uppercase HMAC keys must be rejected.");
  }

  private static void testKeyPrecedence() throws Exception {
    TestServer server = new TestServer();
    try {
      server.start(validScoresResponse());
      HighScoreService service = new HighScoreService(
          new TestConfiguration(server.getUrl(), null, null, null));
      assertEquals(1, service.downloadScores().size(),
          "GET must work without a configured HMAC key.");
      assertEquals(null, service.submitScore(0, 123450, "MJB"),
          "POST must be disabled without a configured HMAC key.");
      assertEquals(1, server.requestCount,
          "Disabled POST must not make an HTTP request.");
    } finally {
      server.close();
    }

    assertPostUsesKey(null, null, KEY, KEY,
        "Embedded release key must be used when property and env are absent.");
    assertPostUsesKey(SECOND_KEY, null, KEY, SECOND_KEY,
        "JVM property key must override embedded release key.");
    assertPostUsesKey(null, SECOND_KEY, KEY, SECOND_KEY,
        "Environment key must override embedded release key.");

    server = new TestServer();
    try {
      server.start(validScoresResponse());
      HighScoreService service = new HighScoreService(
          new TestConfiguration(server.getUrl(), repeat("A", 64), null, KEY));
      assertEquals(null, service.submitScore(0, 123450, "MJB"),
          "Malformed explicit JVM property must disable fallback.");
      assertEquals(0, server.requestCount,
          "Malformed explicit JVM property must not make an HTTP request.");
    } finally {
      server.close();
    }

    server = new TestServer();
    try {
      server.start(validScoresResponse());
      HighScoreService service = new HighScoreService(
          new TestConfiguration(server.getUrl(), null, repeat("A", 64), KEY));
      assertEquals(null, service.submitScore(0, 123450, "MJB"),
          "Malformed explicit environment key must disable fallback.");
      assertEquals(0, server.requestCount,
          "Malformed explicit environment key must not make an HTTP request.");
    } finally {
      server.close();
    }
  }

  private static void testGetAndPostProtocol() throws Exception {
    TestServer server = new TestServer();
    try {
      server.start(validScoresResponse());
      HighScoreService service = new HighScoreService(
          new TestConfiguration(server.getUrl(), null, null, KEY));
      ArrayList<HighScoreService.RemoteHighScore> downloaded =
          service.downloadScores();
      assertEquals(1, downloaded.size(), "GET must return valid rows.");
      assertEquals("GET", server.lastMethod, "GET must use the GET method.");
      assertEquals("1", server.lastProtocolHeader,
          "GET must send the protocol header.");

      ArrayList<HighScoreService.RemoteHighScore> posted =
          service.submitScore(0, 123450, "MJB");
      assertEquals(1, posted.size(), "POST must return valid rows.");
      assertEquals("POST", server.lastMethod, "POST must use the POST method.");
      assertEquals("application/json", server.lastContentType,
          "POST must send a JSON content type.");

      JsonObject body = JsonParser.parseString(server.lastRequestBody)
          .getAsJsonObject();
      assertEquals(EXPECTED_VECTOR, body.get("checksum").getAsString(),
          "POST checksum must use the selected HMAC key.");
      assertEquals(2, server.requestCount,
          "GET and POST must each make exactly one request.");
    } finally {
      server.close();
    }
  }

  private static void testInvalidResponses() throws Exception {
    assertInvalidResponse("missing protocol header", validScoresResponse(),
        true, false, "application/json");
    assertInvalidResponse("bad content type", validScoresResponse(),
        true, true, "text/plain");
    assertInvalidResponse("malformed JSON", "{",
        true, true, "application/json");
    assertInvalidResponse("duplicate tuple", "{\"protocolVersion\":1,"
        + "\"scores\":[{\"world\":0,\"score\":10,\"initials\":\"AAA\"},"
        + "{\"world\":0,\"score\":10,\"initials\":\"AAA\"}]}",
        true, true, "application/json");
    assertInvalidResponse("oversized body", repeat(" ", 8193),
        true, true, "application/json");

    TestServer server = new TestServer();
    try {
      server.status = 500;
      server.start(validScoresResponse());
      HighScoreService service = new HighScoreService(
          new TestConfiguration(server.getUrl(), null, null, KEY));
      assertEquals(null, service.downloadScores(),
          "HTTP failures must be ignored.");
      assertEquals(1, server.requestCount,
          "HTTP failures must not be retried.");
    } finally {
      server.close();
    }
  }

  private static void testHighScoreSemantics() {
    Main main = createMainWithRows(new int[] {500, 400, 300, 200, 50},
        new String[] {"AAA", "BBB", "CCC", "DDD", "EEE"});
    main.worldIndex = 0;
    main.score = 50;
    assertEquals(false, main.isHighScore(),
        "A score equal to fifth place must not qualify.");
    main.score = 60;
    assertEquals(true, main.isHighScore(),
        "A score above fifth place must qualify.");

    int revision = main.getLeaderboardRevisionForTesting();
    HighScoreService.RemoteHighScore duplicate =
        main.accessScoresDatabase(true, 0, 500, "AAA");
    assertEquals(500, duplicate.score,
        "Exact duplicate local submissions may still be submitted remotely.");
    assertRows(main, new int[] {500, 400, 300, 200, 50},
        new String[] {"AAA", "BBB", "CCC", "DDD", "EEE"},
        "Exact duplicate local submissions must not displace rows.");
    assertEquals(revision + 1, main.getLeaderboardRevisionForTesting(),
        "Exact duplicates must advance the local leaderboard revision.");

    main = createMainWithRows(new int[] {500, 400, 300, 200, 50},
        new String[] {"AAA", "BBB", "CCC", "DDD", "EEE"});
    main.accessScoresDatabase(true, 0, 400, "ZZZ");
    assertRows(main, new int[] {500, 400, 400, 300, 200},
        new String[] {"AAA", "BBB", "ZZZ", "CCC", "DDD"},
        "Equal-score insertion must be stable after existing equal scores.");
  }

  private static void testDelayedDownloadDoesNotOverwriteNewerLocalState()
      throws Exception {

    Main main = createMainWithRows(new int[] {500, 400, 300, 200, 100},
        new String[] {"AAA", "BBB", "CCC", "DDD", "EEE"});
    DelayedDownloadService service = new DelayedDownloadService(
        remoteRows(new HighScoreService.RemoteHighScore(0, 9990, "OLD")));
    main.highScoreService = service;
    main.downloadScores();
    assertTrue(service.started.await(2, TimeUnit.SECONDS),
        "Delayed download must start.");
    main.accessScoresDatabase(true, 0, 900, "NEW");
    service.release.countDown();
    waitForScoresDownload(main);
    main.applyPendingRemoteScoresForTesting();

    assertEquals(900, main.highScores[0][0].score,
        "A stale GET must not overwrite newer local leaderboard state.");
    assertEquals("NEW", main.highScores[0][0].initials,
        "A stale GET must not overwrite newer local leaderboard initials.");
  }

  private static void testFailedPostLeavesLocalLeaderboard() throws Exception {
    Main main = createMainWithRows(new int[] {500, 400, 300, 200, 100},
        new String[] {"AAA", "BBB", "CCC", "DDD", "EEE"});
    main.highScoreService = new FailedPostService();
    main.accessScoresDatabaseAsync(true, 0, 900, "NEW");
    waitForUpload(main);
    main.applyPendingRemoteScoresForTesting();
    assertEquals(900, main.highScores[0][0].score,
        "Failed POST must leave the valid local leaderboard in place.");
    assertEquals("NEW", main.highScores[0][0].initials,
        "Failed POST must leave the valid local initials in place.");
  }

  private static void assertPostUsesKey(String propertyKey, String envKey,
      String embeddedKey, String expectedKey, String message) throws Exception {

    TestServer server = new TestServer();
    try {
      server.start(validScoresResponse());
      HighScoreService service = new HighScoreService(
          new TestConfiguration(server.getUrl(), propertyKey, envKey,
          embeddedKey));
      assertEquals(1, service.submitScore(0, 123450, "MJB").size(),
          message);
      JsonObject body = JsonParser.parseString(server.lastRequestBody)
          .getAsJsonObject();
      assertEquals(
          HighScoreService.calculateChecksumForTesting(
          expectedKey, 0, 123450, "MJB"),
          body.get("checksum").getAsString(), message);
    } finally {
      server.close();
    }
  }

  private static void assertInvalidResponse(String name, String body,
      boolean checkRequestCount, boolean includeProtocolHeader,
      String contentType) throws Exception {

    TestServer server = new TestServer();
    try {
      server.includeProtocolHeader = includeProtocolHeader;
      server.contentType = contentType;
      server.start(body);
      HighScoreService service = new HighScoreService(
          new TestConfiguration(server.getUrl(), null, null, KEY));
      assertEquals(null, service.downloadScores(),
          "Invalid response must be rejected: " + name);
      if (checkRequestCount) {
        assertEquals(1, server.requestCount,
            "Invalid response must not be retried: " + name);
      }
    } finally {
      server.close();
    }
  }

  private static Main createMainWithRows(int[] scores, String[] initials) {
    Main main = new Main();
    for(int world = 0; world < main.highScores.length; world++) {
      for(int row = 0; row < main.highScores[world].length; row++) {
        main.highScores[world][row] = new HighScore();
      }
    }
    for(int i = 0; i < scores.length; i++) {
      main.highScores[0][i].score = scores[i];
      main.highScores[0][i].initials = initials[i];
    }
    return main;
  }

  private static void assertRows(Main main, int[] scores, String[] initials,
      String message) {

    for(int i = 0; i < scores.length; i++) {
      assertEquals(scores[i], main.highScores[0][i].score, message);
      assertEquals(initials[i], main.highScores[0][i].initials, message);
    }
  }

  private static ArrayList<HighScoreService.RemoteHighScore> remoteRows(
      HighScoreService.RemoteHighScore score) {

    ArrayList<HighScoreService.RemoteHighScore> rows =
        new ArrayList<HighScoreService.RemoteHighScore>();
    rows.add(score);
    return rows;
  }

  private static String validScoresResponse() {
    return "{\"protocolVersion\":1,\"scores\":["
        + "{\"world\":0,\"score\":123450,\"initials\":\"MJB\"}]}";
  }

  private static void waitForScoresDownload(Main main) throws Exception {
    long deadline = System.currentTimeMillis() + 2000L;
    while(!main.scoresDownloadComplete
        && System.currentTimeMillis() < deadline) {
      Thread.sleep(10L);
    }
    assertEquals(true, main.scoresDownloadComplete,
        "Timed out waiting for score download.");
  }

  private static void waitForUpload(Main main) throws Exception {
    long deadline = System.currentTimeMillis() + 2000L;
    while(!main.uploadComplete && System.currentTimeMillis() < deadline) {
      Thread.sleep(10L);
    }
    assertEquals(true, main.uploadComplete,
        "Timed out waiting for score upload.");
  }

  private static String repeat(String value, int count) {
    StringBuilder builder = new StringBuilder();
    for(int i = 0; i < count; i++) {
      builder.append(value);
    }
    return builder.toString();
  }

  private static void assertTrue(boolean value, String message) {
    if (!value) {
      throw new AssertionError(message);
    }
  }

  private static void assertEquals(Object expected, Object actual,
      String message) {

    if (expected == null ? actual != null : !expected.equals(actual)) {
      throw new AssertionError(message + " Expected <" + expected
          + "> but was <" + actual + ">.");
    }
  }

  private static class TestConfiguration
      implements HighScoreService.Configuration {

    private final String apiUrl;
    private final String propertyKey;
    private final String envKey;
    private final String embeddedKey;

    public TestConfiguration(String apiUrl, String propertyKey, String envKey,
        String embeddedKey) {

      this.apiUrl = apiUrl;
      this.propertyKey = propertyKey;
      this.envKey = envKey;
      this.embeddedKey = embeddedKey;
    }

    public String getSystemProperty(String name) {
      if ("mspacman.scoreApiUrl".equals(name)) {
        return apiUrl;
      }
      if ("mspacman.hmacKeyHex".equals(name)) {
        return propertyKey;
      }
      return null;
    }

    public String getEnvironment(String name) {
      if ("MSPACMAN_HMAC_KEY_HEX".equals(name)) {
        return envKey;
      }
      return null;
    }

    public String getEmbeddedHmacKeyHex() {
      return embeddedKey;
    }
  }

  private static class TestServer implements Closeable {

    private HttpServer server;
    private String body;
    public int requestCount;
    public int status = 200;
    public boolean includeProtocolHeader = true;
    public String contentType = "application/json";
    public String lastMethod;
    public String lastProtocolHeader;
    public String lastContentType;
    public String lastRequestBody;

    public void start(String body) throws IOException {
      this.body = body;
      server = HttpServer.create(
          new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
      server.createContext("/scores", new HttpHandler() {
        public void handle(HttpExchange exchange) throws IOException {
          requestCount++;
          lastMethod = exchange.getRequestMethod();
          lastProtocolHeader = exchange.getRequestHeaders()
              .getFirst("MsPacMan-Protocol-Version");
          lastContentType = exchange.getRequestHeaders()
              .getFirst("Content-Type");
          lastRequestBody = readAll(exchange.getRequestBody());
          if (includeProtocolHeader) {
            exchange.getResponseHeaders().set(
                "MsPacMan-Protocol-Version", "1");
          }
          if (contentType != null) {
            exchange.getResponseHeaders().set("Content-Type", contentType);
          }
          byte[] bytes = TestServer.this.body
              .getBytes(StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(status, bytes.length);
          OutputStream out = exchange.getResponseBody();
          try {
            out.write(bytes);
          } finally {
            out.close();
          }
        }
      });
      server.start();
    }

    public String getUrl() {
      return "http://127.0.0.1:" + server.getAddress().getPort() + "/scores";
    }

    public void close() {
      if (server != null) {
        server.stop(0);
      }
    }
  }

  private static class DelayedDownloadService extends HighScoreService {

    public final CountDownLatch started = new CountDownLatch(1);
    public final CountDownLatch release = new CountDownLatch(1);
    private final ArrayList<RemoteHighScore> scores;

    public DelayedDownloadService(ArrayList<RemoteHighScore> scores) {
      this.scores = scores;
    }

    @Override
    public ArrayList<RemoteHighScore> downloadScores() {
      started.countDown();
      try {
        release.await(2, TimeUnit.SECONDS);
      } catch(InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      return scores;
    }
  }

  private static class FailedPostService extends HighScoreService {

    @Override
    public ArrayList<RemoteHighScore> submitScore(
        int world, int score, String initials) {

      return null;
    }
  }

  private static String readAll(InputStream input) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buffer = new byte[1024];
    while(true) {
      int read = input.read(buffer);
      if (read < 0) {
        break;
      }
      out.write(buffer, 0, read);
    }
    input.close();
    return new String(out.toByteArray(), StandardCharsets.UTF_8);
  }
}
