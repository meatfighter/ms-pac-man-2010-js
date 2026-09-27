package mspacman;
import java.lang.reflect.*;
import java.util.*;
import org.newdawn.slick.*;
/** Production numerical methods and glyph dispatch; the backend image is a recorder. */
public final class CounterParityTest {
    static final TreeMap<Float, Character> glyphs = new TreeMap<Float, Character>();
    static final class Glyph extends Image {
        final char value; Glyph(char value) { super(); this.value=value; }
        @Override public void draw(float x,float y) { glyphs.put(x,value); }
    }
    static final class QuietMain extends Main {
        int cues;
        QuietMain() throws Throwable { super(); }
        @Override public void playSound(Sound sound) { cues++; }
    }
    static void check(boolean ok,String message) { if(!ok)throw new AssertionError(message); }
    public static void main(String[] args) throws Throwable {
        QuietMain main=new QuietMain();
        Image[] symbols=new Image[256]; for(int i=0;i<256;i++)symbols[i]=new Glyph((char)i);
        for(int i=0;i<main.symbols.length;i++)main.symbols[i]=symbols;
        int[] values={0,123,1000000,2147483647};
        String[] expected={"0","123","1000000","2147483647"};
        for(int i=0;i<values.length;i++) {
            glyphs.clear();main.score=values[i];
            main.drawNumber(values[i],10,160,32,Main.WHITE);
            StringBuilder text=new StringBuilder();for(char c:glyphs.values())text.append(c);
            check(text.toString().equals(expected[i]),"native glyph sequence");
            check(glyphs.lastKey()==304 && main.score==values[i],"alignment and score authority");
        }
        PlayingMode playing=new PlayingMode();Field owner=PlayingMode.class.getDeclaredField("main");owner.setAccessible(true);owner.set(playing,main);
        main.score=9990;main.lives=5;playing.addPoints(10);check(main.lives==6 && main.cues==1,"sixth life");
        playing.addPoints(10000);check(main.lives==6 && main.cues==1,"no seventh life/cue");
        System.out.println("CounterParityTest passed actual production formatter, glyph dispatch and awards.");
    }
}
