/*
 * hello_world.java
 * 
 * Copyright 2023 ryanw <ryanw@DESKTOP-HHRD9SE>
 * 
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston,
 * MA 02110-1301, USA.
 * 
 * 
 */


public class MyFirstApp 
{
	
	public static void main(String args[]) {
		System.out.println("I'm freaking awesome!");
		System.out.println("I love Eileen so much. I love Camper too.");
		String birth_month = "May";
		int birth_day = 19;
		//this is a comment.
		int birth_year = 1994;
		System.out.print("Your birthday is " + birth_month + " " + birth_day + " " +birth_year + ".");
		String newline = "\n";
		System.out.print(newline);
int x = 4; // assign 4 to x
while (x > 0) {
// loop code will run because
// x is greater than 3
System.out.print(x);
x = x - 1; // or we’d loop forever
}

int y = 5;
System.out.print("\nBefore the loop.");
while (y>0)
	{
		System.out.print("\nIn the loop.");
		System.out.print("\n" + y);
		y = y-1;
	}
	System.out.print("\nAfter the loop.");
	
	int z = 1;
while (z < 3 ) {
System.out.println("Doo");
System.out.print("Bee");
z = z + 1;
}
if (z == 1){
System.out.print("Do");}
System.out.print("\n");
int beernum = 99;
String word = "bottles";

while (beernum > 0){
	
	if (beernum == 1){
		word = "bottle";
	}
	
	System.out.println(beernum + " " + word + " of beer on the wall.");
	System.out.println(beernum + " " + word + " of beer.");
	System.out.println("Take one down.");
	System.out.println("Pass it around.");
	beernum = beernum - 1;
	
	if (beernum>0){
		System.out.println(beernum + " " + word + " of beer on the wall");}
		else{
			System.out.println("No more bottles of beer on the wall");
	} //end else
	}//end while
	
	double pi = 3.14159;
	System.out.println(pi);
	double d = 30;
	double r = d/2;
	double area = pi*(r*r);
	System.out.println("\nThe area of a circle of " + d + " inch diameter is " + area + "."); 

String[] wordListOne = {"24/7", "wife", "java", "hair", "news", "SQL", "motorcycle"};
String[] wordListTwo = {"cherry","Christian","Fortnite","car","giraffe"};
String[] wordListThree = {"zebra","crocodile","Bentley","hippopotamus","Ezekiel","Fox News","horrible","30,000 foot","parse","parry","rally car","Anne Frank","School","University"};

int oneLength = wordListOne.length;
int twoLength = wordListTwo.length;
int threeLength = wordListThree.length;

System.out.println("Word lengths are as follows:");
System.out.println(oneLength);
System.out.println(twoLength);
System.out.println(threeLength);

int rand1 = (int) (Math.random() *oneLength);
int rand2 = (int) (Math.random() *twoLength);
int rand3 = (int) (Math.random() *threeLength);
String phrase = wordListOne[rand1] + " " + wordListTwo[rand2] + " " + wordListThree[rand3];

System.out.println("What we need is a " + phrase);

x = 3;
while (x>0){
	if (x>2) {
		System.out.print("a");
	}
		x = x-1;
		System.out.print("-");
	if (x==2){
		System.out.print("b c");
	}
	
	if (x==1){
		System.out.print("d");
		x = x-1;
	}

}
System.out.println("");
x = 9;
while ( x < 10 ) {
if ( x > 3) {
System.out.println("big x");
}
x = x-1;
}

x = 5;
while ( x > 1 ) {
x = x - 1;
if ( x < 3) {
System.out.println("small x");
}
}

class Dog {
	String name;
	void bark(){
		System.out.println(name + " says Ruff! Ruff!");
	}
	
	void cry(){
		System.out.println("Wahhhhh! Wahhhhhh!");
	}
	}

Dog Dog1 = new Dog();
Dog1.bark();
Dog1.cry();
Dog1.name = "Camper";

Dog[] myDogs = new Dog[3];

myDogs[0] = new Dog();
myDogs[1] = new Dog();
myDogs[2] = Dog1;

myDogs[0].name = "Ralph";
myDogs[1].name = "Frank";

System.out.println("last dog's name is ");
System.out.println(myDogs[2].name);

x = 0;

while (x < myDogs.length){
myDogs[x].bark();
x = x+ 1;
}

class Books {
String title;
String author;
}

Books [] myBooks = new Books[3];
x = 0;
myBooks[0] = new Books();
myBooks[1] = new Books();
myBooks[2] = new Books(); 
myBooks[0].title = "The Grapes of Java";
myBooks[1].title = "The Java Gatsby";
myBooks[2].title = "The Java Cookbook";
myBooks[0].author = "bob";
myBooks[1].author = "sue";
myBooks[2].author = "ian";
while (x < 3) {
System.out.print(myBooks[x].title);
System.out.print(" by ");
System.out.println(myBooks[x].author);
x = x + 1;
}

class Hobbits{
String name;
}

Hobbits [] h = new Hobbits[3];
z = 0;

while (z<3) {

	h[0] = new Hobbits();
	h[1] = new Hobbits();
	h[2] = new Hobbits();
	if (z==0){
	h[z].name = "Bilbo";
	}
	if (z==1) {
		h[z].name = "Frodo";
	}
	if (z==2){
		h[z].name = "Sam";
	}
	System.out.print(h[z].name + " is a ");
	System.out.println("good hobbit name");
		z = z+1;
}





class TestArrays {


}
int [] index = new int[4];
index[0] = 1;
index[1] = 3;
index[2] = 0;
index[3] = 2;
String [] islands = new String[4];
islands[0] = "Bermuda";
islands[1] = "Fiji";
islands[2] = "Azores";
islands[3] = "Cozumel";
y = 0;
int ref;
while (y < 4) {
ref = index[y];
System.out.print("island = ");
System.out.println(islands[ref]);
y = y + 1;
}

class Triangle {

int height;
int length;
double area;
int x = 0;
void setArea() {
area = (height * length)/2;
}

}
x=0;
Triangle [ ] ta = new Triangle[4];
while ( x < 4 ) {
ta[x] = new Triangle();
ta[x].height = (x + 1) * 2;
ta[x].length = x + 4;
ta[x].setArea();
System.out.print("triangle "+x+", area");
System.out.println(" = " + ta[x].area);
x = x + 1;
}


class Family {

private String name;
private int age;
private int height;
private boolean isBoy;





public void setName (String name){
	this.name = name;
}


public void setAge (int age){
	this.age = age;
}
public void setHeight (int height){
	this.height = height;
}

public void setIsBoy (boolean isBoy){
	this.isBoy = isBoy;
} 

public String getName() {
	return name;
}

public int getAge() {
	return age;
}
public int getHeight(){
	return height;
}

public boolean getIsBoy(){
	return isBoy;
}
}


	Family [] members = new Family[3];

for (int i = 0; i <3; i++){
	members[i] = new Family();
}

			
	 members[0].setName("Eileen");
	 members[1].setName("Steele");
	 members[2].setName("Ryan");
	
	 members[0].setAge(31);
	 members[2].setAge(31);
	
     members[0].setHeight(65);
	 members[1].setHeight(28);
	 members[2].setHeight(71);
	
	 members[1].setIsBoy(true);
	 members[2].setIsBoy(true);
	println;
	x = 0;
	while (x<3){
		if (x == 0){
	System.out.println(members[x].getName() + " is the mom, is " + members[x].getHeight() + " inches tall, " + members[x].getAge() + " years old, and is a boy? " + members[x].getIsBoy());
}		 if(x == 1){
		 System.out.println(members[x].getName() + " is the son, " + members[x].getHeight() + " inches tall, " + members[x].getAge() + " years old, and is a boy? " + members[x].getIsBoy());
	} if (x == 2){ 
	System.out.println(members[x].getName() + " is the dad, " + members[x].getHeight() + " inches tall, " + members[x].getAge() + " years old, and is a boy? " + members[x].getIsBoy());
}
x += 1;
}
	

int p = 2;








}//end main function
}	//end class
	
	
	
	

