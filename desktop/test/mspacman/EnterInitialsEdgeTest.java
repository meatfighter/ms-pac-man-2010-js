package mspacman;
import java.lang.reflect.*;
import java.util.*;
import org.newdawn.slick.*;
public final class EnterInitialsEdgeTest {
  static final String[] NAMES={"Confirm","Left","Right","Down","Up"};
  static void check(boolean ok,String s){if(!ok)throw new AssertionError(s);}
  static void set(Object target,String name,Object value)throws Exception{Field f=target.getClass().getDeclaredField(name);f.setAccessible(true);f.set(target,value);}
  static Object get(Object target,String name)throws Exception{Field f=target.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(target);}
  public static class QuietMain extends Main {
    int uploads,handoffs;
    public void playSound(Sound sound){}
    public void accessScoresDatabaseAsync(boolean update,int world,int score,String initials){uploads++;}
    public void setMode(IMode mode,GameContainer gc){handoffs++;}
  }
  public static void main(String[] args)throws Exception{
    for(int mask=0;mask<32;mask++)for(int index=0;index<3;index++)for(boolean submitted:new boolean[]{false,true}){
      final Set<String> edges=new HashSet<String>();final List<String> calls=new ArrayList<String>();
      QuietMain main=new QuietMain();main.input=(IInput)Proxy.newProxyInstance(IInput.class.getClassLoader(),new Class<?>[]{IInput.class},(proxy,method,values)->{
        String n=method.getName();for(String d:NAMES)if(n.equals("is"+d+"Pressed")){calls.add(d);return edges.remove(d);}if(n.equals("clearKeyPressedRecord"))edges.clear();return method.getReturnType()==boolean.class?false:null;
      });
      EnterInitialsMode mode=new EnterInitialsMode();mode.init(main,null);set(mode,"editingIndex",index);set(mode,"enterPressed",submitted);main.uploadComplete=false;
      for(int i=0;i<5;i++)if((mask&(1<<i))!=0)edges.add(NAMES[i]);
      int expectedIndex=index,uploads=0;String initials="AAA";
      if(!submitted){if((mask&2)!=0)expectedIndex=Math.max(0,index-1);else if((mask&4)!=0||(index!=2&&(mask&1)!=0))expectedIndex=Math.min(2,index+1);else if((mask&8)!=0)initials=initials.substring(0,index)+"B"+initials.substring(index+1);else if((mask&16)!=0)initials=initials.substring(0,index)+" "+initials.substring(index+1);else if((mask&1)!=0)uploads=1;}
      for(int tick=0;tick<2;tick++){calls.clear();mode.update(null);check(calls.equals(Arrays.asList(NAMES)),"All readers once");check(get(mode,"editingIndex").equals(expectedIndex)&&get(mode,"initials").equals(initials),"Priority and no losing edge replay");check(main.uploads==uploads,"No replayed upload");}
      if(!submitted&&uploads==0){edges.add("Down");mode.update(null);check(!get(mode,"initials").equals(initials),"Fresh repress");}
      calls.clear();set(mode,"fadeState",EnterInitialsMode.FADE_OUT);set(mode,"fadeIndex",22);mode.update(null);check(calls.isEmpty()&&main.handoffs==1,"Terminal handoff drains nothing");
    }
    System.out.println("ok - actual Java initials mode: 192 priority/upload cases and fixed-step edge draining");
  }
}
